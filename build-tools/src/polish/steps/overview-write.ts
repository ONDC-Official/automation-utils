import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { PolishStep } from "../types.js";

export const overviewWriteStep: PolishStep = {
    id: "overview-write",
    title: "Write overview.md",
    async run(ctx) {
        const { ui } = ctx;
        if (!ctx.state["overviewGap"]) {
            ui.info("no overview gap — skipping");
            return;
        }
        const markdown = ctx.state["overviewMarkdown"] as string | undefined;
        const path = ctx.state["overviewPath"] as string | undefined;
        if (!markdown || !path) {
            throw new Error("missing markdown or path in state");
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, markdown, "utf-8");
        ui.path("wrote", path);
        ui.succeed("overview.md written");
    },
};
