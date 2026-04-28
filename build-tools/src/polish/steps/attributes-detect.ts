import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import { walkFlowsForObservations } from "../attributes/walker.js";
import { isIncompleteLeaf, lookupExistingLeaf } from "../attributes/placeholder.js";
import type { LeafObservation } from "../attributes/types.js";

export type AttributeGap = {
    obs: LeafObservation;
    existingLeaf: Record<string, unknown> | null;
};

export const attributesDetectStep: PolishStep = {
    id: "attributes-detect",
    title: "Detect incomplete x-attributes",
    async run(ctx) {
        const { ui } = ctx;
        ui.spin("walking flow payloads");
        const observations = walkFlowsForObservations(ctx.config);
        const observationsNonRoot = observations.filter((o) => o.pathKey !== "");
        ui.stat("observations", observations.length);
        ui.stat("usecases seen", new Set(observations.map((o) => o.ucId)).size);

        const forceAll = process.env["POLISH_FORCE_ALL_GAPS"] === "1";
        if (forceAll) {
            ui.warn("POLISH_FORCE_ALL_GAPS=1 — every observed attribute will be treated as a gap");
        }

        ui.spin("checking each observed path against existing x-attributes");
        const existingSets = ctx.config["x-attributes"] ?? [];
        let gaps: AttributeGap[] = [];
        const debug: Array<{
            ucId: string;
            action: string;
            pathKey: string;
            isGap: boolean;
            reason: string;
            existing: Record<string, unknown> | null;
        }> = [];
        for (const obs of observationsNonRoot) {
            const leaf = lookupExistingLeaf(existingSets, obs.ucId, obs.path);
            const incomplete = isIncompleteLeaf(leaf);
            const isGap = forceAll || incomplete;
            let reason: string;
            if (forceAll) reason = "force_all";
            else if (!leaf) reason = "no_existing_leaf";
            else if (incomplete) reason = "incomplete_existing_leaf";
            else reason = "complete_existing_leaf_filtered";
            debug.push({
                ucId: obs.ucId,
                action: obs.action,
                pathKey: obs.pathKey,
                isGap,
                reason,
                existing: (leaf ?? null) as Record<string, unknown> | null,
            });
            if (isGap) {
                gaps.push({
                    obs,
                    existingLeaf: (leaf ?? null) as Record<string, unknown> | null,
                });
            }
        }
        ui.stat("gaps found", gaps.length);
        ui.stat("filtered (already complete)", observationsNonRoot.length - gaps.length);

        const dumpDir = join(ctx.outputDir, ".polish");
        mkdirSync(dumpDir, { recursive: true });
        writeFileSync(
            join(dumpDir, "attributes-detect-debug.json"),
            JSON.stringify(
                {
                    totalObservations: observationsNonRoot.length,
                    gapsCount: gaps.length,
                    forceAll,
                    entries: debug,
                },
                null,
                2,
            ) + "\n",
            "utf-8",
        );
        ui.path("detect debug", join(dumpDir, "attributes-detect-debug.json"));

        // Test-mode cap
        const limitRaw = process.env["POLISH_ATTR_LIMIT"];
        if (limitRaw) {
            const n = Number(limitRaw);
            if (Number.isFinite(n) && n > 0 && gaps.length > n) {
                gaps = gaps.slice(0, n);
                ui.warn(
                    `POLISH_ATTR_LIMIT=${n} — processing only first ${n} gap(s) for test`,
                );
            }
        }

        // Group by usecase → action
        const byUcAction = new Map<string, Map<string, AttributeGap[]>>();
        for (const g of gaps) {
            if (!byUcAction.has(g.obs.ucId)) byUcAction.set(g.obs.ucId, new Map());
            const actionMap = byUcAction.get(g.obs.ucId)!;
            if (!actionMap.has(g.obs.action)) actionMap.set(g.obs.action, []);
            actionMap.get(g.obs.action)!.push(g);
        }

        ctx.state["attributeGaps"] = gaps;
        ctx.state["attributeGapsGrouped"] = byUcAction;
        ctx.state["attributeObservations"] = observationsNonRoot;

        ui.stat(
            "grouped",
            `${byUcAction.size} usecase(s) · ${Array.from(byUcAction.values()).reduce((n, m) => n + m.size, 0)} action(s)`,
        );
        if (gaps.length === 0) {
            ui.succeed("no gaps — attributes already complete");
        } else {
            ui.succeed(`will polish ${gaps.length} attribute(s)`);
        }
    },
};
