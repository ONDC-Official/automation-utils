import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import type { ContextBundle, LeafDraft, ReviewEntry, ReviewFile } from "../attributes/types.js";
import type { AttributesReviewSession, ReviewSession } from "../review/types.js";
import { scoreAttributeDraft, getConfidenceThreshold } from "../review/confidence.js";
import { runReviewServer } from "../review/server.js";

export const attributesReviewStep: PolishStep = {
    id: "attributes-review",
    title: "User review of attribute drafts",
    async run(ctx) {
        const { ui } = ctx;
        const bundlesByUc = ctx.state["attributeBundles"] as
            | Map<string, Map<string, ContextBundle[]>>
            | undefined;
        const draftsByUc = ctx.state["attributeDrafts"] as
            | Map<string, Map<string, LeafDraft[]>>
            | undefined;
        if (!bundlesByUc || !draftsByUc || bundlesByUc.size === 0) {
            ui.info("nothing to review — skipping");
            return;
        }

        const reviewDir = join(ctx.outputDir, ".polish", "attributes-review");
        mkdirSync(reviewDir, { recursive: true });
        ui.path("review dir", reviewDir);

        const threshold = getConfidenceThreshold();
        const files: ReviewFile[] = [];

        let totalEntries = 0;
        let autoApproved = 0;
        let lowCount = 0;

        for (const [ucId, actionMap] of bundlesByUc) {
            for (const [action, bundles] of actionMap) {
                const drafts = draftsByUc.get(ucId)?.get(action) ?? [];
                if (bundles.length === 0 || drafts.length !== bundles.length) continue;

                const entries: ReviewEntry[] = bundles.map((b, i) => {
                    const draft = drafts[i]!;
                    const confidence = scoreAttributeDraft(b, draft);
                    const approved = confidence.score >= threshold;
                    if (approved) autoApproved++;
                    if (confidence.score < 0.5) lowCount++;
                    totalEntries++;
                    return {
                        path: b.obs.pathKey,
                        approved,
                        draft,
                        confidence,
                        context_preview: {
                            sample_values: b.obs.sampleValues,
                            referenced_in: b.refs.map((r) => ({
                                flow: r.flowId,
                                action_id: r.actionId,
                                kind: r.kind,
                                snippet: r.snippet,
                            })),
                            save_data: b.saveData.map((s) => ({
                                flow: s.flowId,
                                key: s.key,
                                jsonpath: s.jsonpath,
                            })),
                            openapi_info: b.openapi
                                ? b.openapi.description ??
                                  (b.openapi.customDescription
                                      ? JSON.stringify(b.openapi.customDescription)
                                      : null)
                                : null,
                        },
                    };
                });

                const file: ReviewFile = {
                    _instructions:
                        "Reviewed via web UI. Toggle `approved` per entry. " +
                        "Edit draft fields as needed. Save from the UI to persist.",
                    usecase: ucId,
                    action,
                    attributes: entries,
                };
                files.push(file);
            }
        }

        if (files.length === 0) {
            ui.info("no draft files to review — skipping");
            return;
        }

        const session: AttributesReviewSession = { kind: "attributes", threshold, files };

        // Initial write (pre-approved state) for audit trail.
        persist(reviewDir, session);

        ui.stat("drafts", totalEntries);
        ui.stat("auto-approved", `${autoApproved} (conf ≥ ${threshold.toFixed(2)})`);
        ui.stat("low-conf (<0.5)", lowCount);

        const finalized = (await runReviewServer({
            kind: "attributes",
            session,
            writeBack: (s) => persist(reviewDir, s as AttributesReviewSession),
            ui,
            llm: ctx.llm,
        })) as AttributesReviewSession;

        const approved = new Map<string, LeafDraft>();
        for (const f of finalized.files) {
            for (const e of f.attributes ?? []) {
                if (!e.approved) continue;
                approved.set(`${f.usecase}::${f.action}::${e.path}`, e.draft);
            }
        }

        ctx.state["approvedDrafts"] = approved;
        ui.succeed(`${approved.size} draft(s) approved in total`);
    },
};

function persist(reviewDir: string, session: ReviewSession): void {
    if (session.kind !== "attributes") return;
    for (const file of session.files) {
        const slug = `${slugify(file.usecase)}__${slugify(file.action)}.json`;
        writeFileSync(join(reviewDir, slug), JSON.stringify(file, null, 2) + "\n", "utf-8");
    }
}

function slugify(s: string): string {
    return s.replace(/[^\w]+/g, "_");
}
