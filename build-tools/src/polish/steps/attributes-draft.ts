import type { PolishStep } from "../types.js";
import { draftLeaves, NO_DATA_SENTINEL, type BatchEvent, type DraftItem } from "../attributes/draft.js";
import type { DedupGroup, LeafDraft } from "../attributes/types.js";
import { deriveOwner, deriveRequired, deriveType, deriveUsage } from "../attributes/dedup.js";
import { getConcurrency, runWithConcurrency } from "../review/concurrency.js";
import { createParaphraseController } from "../review/paraphrase-server.js";

type GroupUnit = {
    items: DraftItem[];
    group: DedupGroup;
};

type Tally = {
    unitsDone: number;
    unitsTotal: number;
    retries: number;
    fallbacks: number;
    inflight: number;
};

function fmtMs(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export const attributesDraftStep: PolishStep = {
    id: "attributes-draft",
    title: "LLM-draft descriptions for incomplete attributes (deduped)",
    async run(ctx) {
        const { ui } = ctx;
        const groups = ctx.state["attributeDedupGroups"] as DedupGroup[] | undefined;
        const flowsPerAction = ctx.state["flowsPerAction"] as Map<string, number> | undefined;
        if (!groups || groups.length === 0) {
            ui.info("no dedup groups — skipping draft");
            return;
        }

        const units: GroupUnit[] = groups.map((g) => ({
            items: [{ action: g.members[0]!.action, bundle: g.representative }],
            group: g,
        }));

        const totalGroups = units.length;
        const totalMembers = groups.reduce((n, g) => n + g.members.length, 0);
        const limit = getConcurrency();

        ui.info(
            `${totalGroups} group(s) representing ${totalMembers} attribute(s) · concurrency ${limit}`,
        );

        const tally: Tally = {
            unitsDone: 0,
            unitsTotal: totalGroups,
            retries: 0,
            fallbacks: 0,
            inflight: 0,
        };

        const refreshSpinner = (): void => {
            ui.update(
                `groups ${tally.unitsDone}/${tally.unitsTotal} · inflight ${tally.inflight} · retries ${tally.retries} · fallbacks ${tally.fallbacks}`,
            );
        };

        ui.spin(`groups 0/${tally.unitsTotal} · inflight 0`);

        // Sentinel paraphrase queue served via browser UI. Lazy-starts a server
        // when the first <no-enough-data> draft arrives. Drafting never blocks.
        const paraphrase = createParaphraseController(ctx.llm, ui);
        let sentinelSeen = 0;

        const drafts = new Map<string, Map<string, LeafDraft[]>>();
        const sizeMap = new Map<string, Map<string, number>>();
        for (const g of groups) {
            for (const m of g.members) {
                if (!sizeMap.has(m.uc)) sizeMap.set(m.uc, new Map());
                const am = sizeMap.get(m.uc)!;
                am.set(m.action, Math.max(am.get(m.action) ?? 0, m.index + 1));
            }
        }
        for (const [uc, am] of sizeMap) {
            const ucMap = new Map<string, LeafDraft[]>();
            for (const [action, size] of am) {
                ucMap.set(action, new Array(size).fill(null) as LeafDraft[]);
            }
            drafts.set(uc, ucMap);
        }

        await runWithConcurrency(units, limit, async (u) => {
            tally.inflight++;
            refreshSpinner();
            const repPath = u.group.representative.obs.pathKey;
            const started = Date.now();

            const onEvent = (ev: BatchEvent): void => {
                if (ev.kind === "ok") {
                    if (ev.attempt > 0) {
                        ui.note(
                            `✓ ok     ${repPath} after retry #${ev.attempt} in ${fmtMs(ev.elapsedMs)}`,
                            "green",
                        );
                    } else {
                        ui.note(`✓ ok     ${repPath} in ${fmtMs(ev.elapsedMs)}`, "green");
                    }
                } else if (ev.kind === "retry") {
                    tally.retries++;
                    refreshSpinner();
                    ui.note(
                        `↻ retry  ${repPath} (attempt ${ev.attempt}) — ${truncate(ev.reason, 120)}`,
                        "yellow",
                    );
                } else if (ev.kind === "fallback") {
                    tally.fallbacks++;
                    refreshSpinner();
                    ui.note(`✗ dummy  ${repPath} — ${truncate(ev.reason, 120)}`, "red");
                }
            };

            try {
                const arr = await draftLeaves(ctx.llm, u.items, onEvent);
                const repDraft = arr[0]!;
                const infoText = (repDraft.info ?? "").trim();
                if (infoText) {
                    ui.note(`✎ ${repPath}`, "cyan");
                    ui.note(`  "${infoText}"`, "dim");
                } else {
                    ui.note(`✎ ${repPath} — (empty draft, no usable evidence)`, "yellow");
                }
                const extras: string[] = [];
                if (repDraft.enums?.length) extras.push(`${repDraft.enums.length} enum(s)`);
                if (repDraft.tags?.length) extras.push(`${repDraft.tags.length} tag(s)`);
                if (extras.length) ui.note(`  + ${extras.join(" · ")}`, "dim");
                const memberDrafts: LeafDraft[] = [];
                for (const m of u.group.members) {
                    const total = flowsPerAction?.get(m.action) ?? 0;
                    const cloned: LeafDraft = {
                        ...repDraft,
                        owner: deriveOwner(m.action),
                        required: deriveRequired(m.bundle, total),
                        usage: deriveUsage(m.bundle),
                        type: deriveType(m.bundle),
                    };
                    if (repDraft.enums) cloned.enums = repDraft.enums.map((e) => ({ ...e }));
                    if (repDraft.tags) cloned.tags = repDraft.tags.map((t) => ({ ...t }));
                    drafts.get(m.uc)!.get(m.action)![m.index] = cloned;
                    memberDrafts.push(cloned);
                }
                if (infoText === NO_DATA_SENTINEL) {
                    sentinelSeen++;
                    paraphrase.push({
                        path: repPath,
                        action: u.group.members[0]!.action,
                        drafts: memberDrafts,
                    });
                }
                const elapsed = Date.now() - started;
                ui.note(
                    `■ done   ${repPath} in ${fmtMs(elapsed)} (cloned to ${u.group.members.length})`,
                    "dim",
                );
                return null;
            } finally {
                tally.inflight--;
                tally.unitsDone++;
                paraphrase.setProgress({
                    unitsDone: tally.unitsDone,
                    unitsTotal: tally.unitsTotal,
                });
                refreshSpinner();
            }
        });

        paraphrase.setDraftingDone();
        if (sentinelSeen > 0) {
            ui.spin(
                `drafting complete · waiting for ${sentinelSeen} paraphrase(s) in browser — click "Continue to review" when done`,
            );
        }
        await paraphrase.waitForFinalize();
        await paraphrase.shutdown();

        for (const [, am] of drafts) {
            for (const [action, arr] of am) {
                for (let i = 0; i < arr.length; i++) {
                    if (!arr[i]) {
                        arr[i] = {
                            required: false,
                            usage: "",
                            info: "AUTO-FALLBACK: no draft produced for this slot.",
                            owner: deriveOwner(action),
                            type: "string",
                        };
                    }
                }
            }
        }

        ui.succeed(
            `drafted ${totalGroups} group(s) → ${totalMembers} attribute(s)` +
                (tally.retries ? ` · ${tally.retries} retry(ies)` : "") +
                (tally.fallbacks ? ` · ${tally.fallbacks} fallback group(s)` : "") +
                (sentinelSeen ? ` · ${sentinelSeen} sentinel(s) routed through paraphrase UI` : ""),
        );
        if (tally.fallbacks > 0) {
            ui.warn(
                `${tally.fallbacks} group(s) fell back to DUMMY drafts — review affected entries carefully.`,
            );
        }
        ctx.state["attributeDrafts"] = drafts;
    },
};

function truncate(s: string, n: number): string {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
