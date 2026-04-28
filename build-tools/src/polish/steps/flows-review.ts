import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import type { FlowReviewEntry, FlowReviewFile, FlowDraft } from "../flows/types.js";
import type { FlowsReviewSession, ReviewSession } from "../review/types.js";
import type { FlowDescDraft } from "./flows-draft.js";
import { getConfidenceThreshold, scoreFlowDescription } from "../review/confidence.js";
import { runReviewServer } from "../review/server.js";

export type ApprovedFlowDescs = {
    flowLevel: Map<string, FlowDraft>; // flowId -> draft
    stepLevel: Map<string, FlowDraft>; // `${flowId}::${stepIndex}` -> draft
};

export const flowsReviewStep: PolishStep = {
    id: "flows-review",
    title: "User review of drafted flow/step descriptions",
    async run(ctx) {
        const { ui } = ctx;
        const drafts = ctx.state["flowDescDrafts"] as FlowDescDraft[] | undefined;
        if (!drafts || drafts.length === 0) {
            ui.info("nothing to review — skipping");
            return;
        }

        const reviewDir = join(ctx.outputDir, ".polish", "flows-review");
        mkdirSync(reviewDir, { recursive: true });
        ui.path("review dir", reviewDir);

        const threshold = getConfidenceThreshold();

        // group by flowId — each flow gets its own file, entries include the
        // flow-level card first (if any) followed by per-step cards.
        const byFlow = new Map<string, FlowDescDraft[]>();
        for (const d of drafts) {
            const id = d.kind === "flow" ? d.ref.flowId : d.ref.flowId;
            if (!byFlow.has(id)) byFlow.set(id, []);
            byFlow.get(id)!.push(d);
        }

        const files: FlowReviewFile[] = [];
        let totalEntries = 0;
        let autoApproved = 0;
        let lowCount = 0;

        for (const [flowId, items] of byFlow) {
            // sort: flow-level first, then steps in order
            items.sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === "flow" ? -1 : 1;
                if (a.kind === "step" && b.kind === "step") return a.ref.stepIndex - b.ref.stepIndex;
                return 0;
            });

            const entries: FlowReviewEntry[] = items.map((d) => {
                const confidence = scoreFlowDescription(d);
                const approved = !d.error && confidence.score >= threshold;
                if (approved) autoApproved++;
                if (confidence.score < 0.5) lowCount++;
                totalEntries++;

                if (d.kind === "flow") {
                    return {
                        kind: "flow",
                        flowId: d.ref.flowId,
                        usecase: d.ref.usecase,
                        tags: d.ref.tags,
                        approved,
                        draft: { description: d.description },
                        confidence,
                        current: { description: d.ref.currentDescription },
                    };
                }
                return {
                    kind: "step",
                    flowId: d.ref.flowId,
                    usecase: d.ref.usecase,
                    stepIndex: d.ref.stepIndex,
                    action: d.ref.action,
                    actionId: d.ref.actionId,
                    owner: d.ref.owner,
                    approved,
                    draft: { description: d.description },
                    confidence,
                    current: { description: d.ref.currentDescription },
                };
            });

            files.push({
                _instructions:
                    "Reviewed via web UI. Toggle `approved` per entry. Description is editable. " +
                    "Save from the UI to persist.",
                flowId,
                entries,
            });
        }

        if (files.length === 0) {
            ui.info("no drafted flows — skipping");
            return;
        }

        const session: FlowsReviewSession = { kind: "flows", threshold, files };
        persist(reviewDir, session);

        ui.stat("drafts", totalEntries);
        ui.stat("auto-approved", `${autoApproved} (conf ≥ ${threshold.toFixed(2)})`);
        ui.stat("low-conf (<0.5)", lowCount);

        const finalized = (await runReviewServer({
            kind: "flows",
            session,
            writeBack: (s) => persist(reviewDir, s as FlowsReviewSession),
            ui,
        })) as FlowsReviewSession;

        const approvedFlow = new Map<string, FlowDraft>();
        const approvedStep = new Map<string, FlowDraft>();
        for (const f of finalized.files) {
            for (const e of f.entries ?? []) {
                if (!e.approved) continue;
                if (e.kind === "flow") {
                    approvedFlow.set(e.flowId, e.draft);
                } else {
                    approvedStep.set(`${e.flowId}::${e.stepIndex}`, e.draft);
                }
            }
        }

        const approved: ApprovedFlowDescs = { flowLevel: approvedFlow, stepLevel: approvedStep };
        ctx.state["approvedFlowDescs"] = approved;
        ui.succeed(
            `${approvedFlow.size} flow + ${approvedStep.size} step description(s) approved`,
        );
    },
};

function persist(reviewDir: string, session: ReviewSession): void {
    if (session.kind !== "flows") return;
    for (const file of session.files) {
        const slug = `${slugify(file.flowId)}.json`;
        writeFileSync(join(reviewDir, slug), JSON.stringify(file, null, 2) + "\n", "utf-8");
    }
}

function slugify(s: string): string {
    return s.replace(/[^\w]+/g, "_");
}
