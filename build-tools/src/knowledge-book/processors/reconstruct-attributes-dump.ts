import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as yamlStringify } from "yaml";
import type { KnowledgeProcessor, KnowledgeSection, ProcessorContext } from "../types.js";
import { reconstructAttributesFromExamples } from "../reconstruct-attributes.js";

export const reconstructAttributesDumpProcessor: KnowledgeProcessor = {
    id: "reconstruct-attributes-dump",
    title: "Reconstructed Attributes (Debug Dump)",

    async run(ctx: ProcessorContext): Promise<KnowledgeSection> {
        const { config, outputDir } = ctx;
        const reconstructed = reconstructAttributesFromExamples(config);

        const outDir = join(outputDir, "reconstructed-attributes");
        mkdirSync(outDir, { recursive: true });

        const yamlPath = join(outDir, "x-attributes.yaml");
        const jsonPath = join(outDir, "x-attributes.json");
        writeFileSync(yamlPath, yamlStringify({ "x-attributes": reconstructed }), "utf-8");
        writeFileSync(jsonPath, JSON.stringify(reconstructed, null, 2), "utf-8");

        const useCases = reconstructed.map((s) => s.meta?.use_case_id ?? "(none)");
        const markdown = [
            `# Reconstructed Attributes (Debug Dump)`,
            ``,
            `Reconstructed \`x-attributes\` from all \`x-flows\` example payloads.`,
            ``,
            `- Sets: ${reconstructed.length}`,
            `- Use cases: ${useCases.join(", ")}`,
            ``,
            `Output files:`,
            ``,
            `- \`${yamlPath}\``,
            `- \`${jsonPath}\``,
            ``,
        ].join("\n");

        return {
            id: "reconstruct-attributes-dump",
            title: "Reconstructed Attributes (Debug Dump)",
            markdown,
            metadata: { outDir, yamlPath, jsonPath, setCount: reconstructed.length },
        };
    },
};
