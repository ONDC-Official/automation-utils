import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import type { BundleRef, ContextBundle, DedupGroup } from "../attributes/types.js";
import { groupBundles } from "../attributes/dedup.js";

type FlowCfg = { steps?: Array<{ api?: string }> };

function computeFlowsPerAction(config: {
    "x-flows"?: Array<{ id: string; config?: unknown }>;
}): Map<string, number> {
    const seen = new Map<string, Set<string>>();
    for (const flow of config["x-flows"] ?? []) {
        const cfg = flow.config as FlowCfg | undefined;
        for (const step of cfg?.steps ?? []) {
            const api = step.api;
            if (!api) continue;
            if (!seen.has(api)) seen.set(api, new Set());
            seen.get(api)!.add(flow.id);
        }
    }
    const out = new Map<string, number>();
    for (const [api, set] of seen) out.set(api, set.size);
    return out;
}

export const attributesDedupStep: PolishStep = {
    id: "attributes-dedup",
    title: "Dedup attributes by signature + ref fingerprint (cuts LLM calls)",
    async run(ctx) {
        const { ui } = ctx;
        const bundlesByUc = ctx.state["attributeBundles"] as
            | Map<string, Map<string, ContextBundle[]>>
            | undefined;
        if (!bundlesByUc || bundlesByUc.size === 0) {
            ui.info("no bundles — skipping dedup");
            return;
        }

        const flat: BundleRef[] = [];
        for (const [uc, actionMap] of bundlesByUc) {
            for (const [action, bundles] of actionMap) {
                for (let i = 0; i < bundles.length; i++) {
                    flat.push({ uc, action, index: i, bundle: bundles[i]! });
                }
            }
        }

        ui.spin(`grouping ${flat.length} attribute(s) by signature`);
        const groups: DedupGroup[] = groupBundles(flat);
        const flowsPerAction = computeFlowsPerAction(
            ctx.config as unknown as { "x-flows"?: Array<{ id: string; config?: unknown }> },
        );

        ctx.state["attributeDedupGroups"] = groups;
        ctx.state["flowsPerAction"] = flowsPerAction;

        const totalAttrs = flat.length;
        const totalGroups = groups.length;
        const calls = totalGroups;
        const callsSaved = totalAttrs - totalGroups;
        const pct = totalAttrs > 0 ? Math.round((callsSaved / totalAttrs) * 100) : 0;

        const dumpDir = join(ctx.outputDir, ".polish");
        mkdirSync(dumpDir, { recursive: true });
        const dumpPath = join(dumpDir, "attributes-dedup-groups.json");
        const dump = {
            totalAttrs,
            totalGroups,
            callsSaved,
            savingsPct: pct,
            groups: groups.map((g) => ({
                signature: g.signature,
                refFingerprint: g.refFingerprint,
                pathKey: g.representative.obs.pathKey,
                memberCount: g.members.length,
                members: g.members.map((m) => ({ uc: m.uc, action: m.action })),
                openapiDescription: g.representative.openapi?.description ?? null,
            })),
        };
        writeFileSync(dumpPath, JSON.stringify(dump, null, 2) + "\n", "utf-8");
        ui.path("dedup dump", dumpPath);

        ui.succeed(
            `${totalAttrs} attribute(s) → ${totalGroups} group(s) · ${callsSaved} call(s) saved (${pct}%)`,
        );
        ui.stat("attributes", totalAttrs);
        ui.stat("groups", totalGroups);
        ui.stat("savings", `${callsSaved} (${pct}%)`);
    },
};
