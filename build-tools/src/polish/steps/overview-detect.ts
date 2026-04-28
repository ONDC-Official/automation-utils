import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";

const STUB_BODY_RE = /^add an overview of .* (specification\s+)?here\.?$/i;

export const overviewDetectStep: PolishStep = {
    id: "overview-detect",
    title: "Detect overview stub/empty",
    async run(ctx) {
        const { ui } = ctx;
        const path = join(ctx.outputDir, "docs", "overview.md");

        if (!existsSync(path)) {
            ctx.state["overviewGap"] = true;
            ctx.state["overviewPath"] = path;
            ui.warn(`overview.md missing — will generate`);
            return;
        }

        const raw = readFileSync(path, "utf-8");
        const body = stripLeadingHeading(raw).trim();
        const gap = body.length < 40 || STUB_BODY_RE.test(body);

        ctx.state["overviewGap"] = gap;
        ctx.state["overviewPath"] = path;
        ui.stat("file", path);
        ui.stat("body chars", body.length);
        if (gap) ui.warn("stub detected — will regenerate");
        else ui.succeed("overview already populated — skipping phase");
    },
};

function stripLeadingHeading(raw: string): string {
    const lines = raw.split("\n");
    if (lines[0]?.startsWith("#")) return lines.slice(1).join("\n");
    return raw;
}
