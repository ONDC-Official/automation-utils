import { join } from "path";
import type { PolishStep } from "../types.js";
import { loadPdfs } from "../context-pdfs/load.js";

/**
 * Loads --context-pdf inputs into a BM25 index attached to `ctx.pdfIndex`.
 * No-op when no PDFs were supplied — downstream steps then see
 * `pdfIndex === undefined` and skip excerpt injection.
 *
 * Runs early (after scaffold) so the cache dir under outputDir already
 * exists.
 */
export const contextPdfsLoadStep: PolishStep = {
    id: "context-pdfs-load",
    title: "Load context PDFs",
    async run(ctx) {
        const { ui, outputDir, contextPdfPaths } = ctx;
        if (!contextPdfPaths || contextPdfPaths.length === 0) {
            ui.info("no --context-pdf supplied — skipping");
            return;
        }
        const cacheDir = join(outputDir, ".polish", "context-pdfs");
        ui.spin(`loading ${contextPdfPaths.length} PDF(s)`);
        const { index, stats } = await loadPdfs(contextPdfPaths, cacheDir);
        ctx.pdfIndex = index;
        ui.succeed(
            `indexed ${stats.chunks} chunk(s) from ${index.sources.length} PDF(s) ` +
                `(${stats.extracted} extracted, ${stats.cached} cached)`,
        );
        for (const src of index.sources) ui.note(`· ${src}`, "dim");
    },
};
