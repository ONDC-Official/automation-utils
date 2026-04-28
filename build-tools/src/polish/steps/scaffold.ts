import { cpSync, existsSync, mkdirSync } from "fs";
import type { PolishStep } from "../types.js";

export const scaffoldStep: PolishStep = {
    id: "scaffold",
    title: "Scaffold output split-config",
    async run(ctx) {
        const { inputDir, outputDir, ui } = ctx;
        ui.spin(`mirroring ${inputDir} → ${outputDir}`);
        mkdirSync(outputDir, { recursive: true });
        cpSync(inputDir, outputDir, {
            recursive: true,
            force: true,
            errorOnExist: false,
        });
        if (!existsSync(`${outputDir}/docs`)) {
            mkdirSync(`${outputDir}/docs`, { recursive: true });
        }
        ui.succeed(`scaffold ready at ${outputDir}`);
    },
};
