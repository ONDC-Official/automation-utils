import type { PolishStep } from "../types.js";
import { loadReuseIndex } from "../attributes/reuse.js";

/**
 * Loads --reuse-from inputs (external `.polish` / attributes-review folders from
 * prior polish runs) into an index attached to `ctx.reuseIndex`, keyed by
 * `(action, pathKey)` ignoring usecase. Only APPROVED, non-fallback descriptions
 * are indexed.
 *
 * No-op when no --reuse-from given. Runs early (after scaffold / context-pdfs)
 * so the attribute steps downstream can look up matches. Never aborts — bad
 * paths and malformed files surface as warnings.
 */
export const reuseLoadStep: PolishStep = {
    id: "reuse-load",
    title: "Load external reviewed descriptions to reuse",
    async run(ctx) {
        const { ui, reuseFromPaths } = ctx;
        if (!reuseFromPaths || reuseFromPaths.length === 0) {
            ui.info("no --reuse-from supplied — skipping");
            return;
        }
        ui.spin(`loading external reviews from ${reuseFromPaths.length} source(s)`);
        const { index, warnings } = loadReuseIndex(reuseFromPaths);
        ctx.reuseIndex = index;
        ui.succeed(
            `indexed ${index.stats.kept} reusable description(s) across ${index.stats.keys} key(s) ` +
                `from ${index.stats.files} file(s)` +
                (ctx.reuseVerbatim ? " · mode: verbatim" : " · mode: enrich"),
        );
        for (const w of warnings) ui.warn(w);
    },
};
