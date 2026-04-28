import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import { buildBundles } from "../attributes/mine-context.js";
import type { ContextBundle } from "../attributes/types.js";
import type { AttributeGap } from "./attributes-detect.js";

function slugify(s: string): string {
    return s.replace(/[^\w]+/g, "_");
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const attributesMineStep: PolishStep = {
    id: "attributes-mine",
    title: "Mine per-attribute context (OpenAPI + decoded JS + saveData)",
    async run(ctx) {
        const { ui } = ctx;
        const grouped = ctx.state["attributeGapsGrouped"] as
            | Map<string, Map<string, AttributeGap[]>>
            | undefined;
        if (!grouped || grouped.size === 0) {
            ui.info("no gaps — skipping mine");
            return;
        }

        const bundlesByUc = new Map<string, Map<string, ContextBundle[]>>();
        let total = 0;
        let withRefs = 0;
        let withSave = 0;
        let withOpenapi = 0;

        const actionList: Array<{ uc: string; action: string; gaps: AttributeGap[] }> = [];
        for (const [ucId, actionMap] of grouped) {
            for (const [action, gaps] of actionMap) {
                actionList.push({ uc: ucId, action, gaps });
            }
        }

        const timingsLogPath = join(ctx.outputDir, ".polish", "attributes-mine-timings.log");
        mkdirSync(join(ctx.outputDir, ".polish"), { recursive: true });
        writeFileSync(timingsLogPath, "timestamp\taction\tpathKey\telapsedMs\tdone/total\n", "utf-8");

        let done = 0;
        let lastTick = Date.now();
        for (const { uc, action, gaps } of actionList) {
            const actionStarted = Date.now();
            ui.spin(
                `mining ${action} (${gaps.length} attr) — ${done}/${actionList.length} action(s) done`,
            );
            const obs = gaps.map((g) => g.obs);
            const bundles = buildBundles(ctx.config, obs, (p) => {
                appendFileSync(
                    timingsLogPath,
                    `${new Date().toISOString()}\t${action}\t${p.pathKey}\t${p.elapsedMs}\t${p.done}/${p.total}\n`,
                    "utf-8",
                );
                const now = Date.now();
                if (now - lastTick < 200 && p.done !== p.total) return;
                lastTick = now;
                ui.update(
                    `mining ${action} ${p.done}/${p.total} · last: ${truncate(p.pathKey, 50)} (${p.elapsedMs}ms) · ${done}/${actionList.length} action(s) done`,
                );
            });
            if (!bundlesByUc.has(uc)) bundlesByUc.set(uc, new Map());
            bundlesByUc.get(uc)!.set(action, bundles);
            total += bundles.length;
            for (const b of bundles) {
                if (b.refs.length) withRefs++;
                if (b.saveData.length) withSave++;
                if (
                    b.openapi &&
                    (b.openapi.description || b.openapi.customDescription)
                )
                    withOpenapi++;
            }
            done++;
            const elapsed = Date.now() - actionStarted;
            ui.note(
                `✓ ${action} mined ${gaps.length} attr in ${elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`}`,
                "green",
            );
        }

        ctx.state["attributeBundles"] = bundlesByUc;

        const dumpDir = join(ctx.outputDir, ".polish", "attributes-detected");
        mkdirSync(dumpDir, { recursive: true });
        for (const [uc, actionMap] of bundlesByUc) {
            for (const [action, bundles] of actionMap) {
                const slug = `${slugify(uc)}__${slugify(action)}.json`;
                const payload = {
                    usecase: uc,
                    action,
                    count: bundles.length,
                    attributes: bundles.map((b) => ({
                        path: b.obs.pathKey,
                        valueType: b.obs.valueType,
                        sampleValues: b.obs.sampleValues,
                        sampleCounts: b.obs.sampleCounts,
                        mostCommonValue: b.obs.mostCommonValue,
                        seenInFlows: b.obs.seenInFlows,
                        isArrayIndexed: b.obs.isArrayIndexed,
                        openapi: b.openapi,
                        refs: b.refs,
                        saveData: b.saveData,
                        sessionReads: b.sessionReads,
                        existing: b.existing,
                        crossFlow: b.crossFlow,
                    })),
                };
                writeFileSync(
                    join(dumpDir, slug),
                    JSON.stringify(payload, null, 2) + "\n",
                    "utf-8",
                );
            }
        }
        ui.path("detected dump", dumpDir);

        ui.succeed(`mined context for ${total} attribute(s)`);
        ui.stat("with openapi", `${withOpenapi}/${total}`);
        ui.stat("with refs", `${withRefs}/${total}`);
        ui.stat("with saveData", `${withSave}/${total}`);
    },
};
