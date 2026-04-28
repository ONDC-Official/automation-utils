import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { PolishStep } from "../types.js";
import type { DedupGroup } from "../attributes/types.js";
import { buildPrompt, itemToLLMInput, type DraftItem } from "../attributes/draft.js";

function slugify(s: string): string {
    return s.replace(/[^\w]+/g, "_").slice(0, 80);
}

export const attributesPreviewPromptsStep: PolishStep = {
    id: "attributes-preview-prompts",
    title: "Write the exact LLM prompt for each dedup group to disk",
    async run(ctx) {
        const { ui } = ctx;
        const groups = ctx.state["attributeDedupGroups"] as DedupGroup[] | undefined;
        if (!groups || groups.length === 0) {
            ui.info("no dedup groups — skipping prompt preview");
            return;
        }

        const dir = join(ctx.outputDir, ".polish", "llm-prompts");
        mkdirSync(dir, { recursive: true });

        const indexLines: string[] = [
            "file\tsignature\tpathKey\trepresentativeAction\tmemberCount\tpromptChars",
        ];

        for (const g of groups) {
            const item: DraftItem = {
                action: g.members[0]!.action,
                bundle: g.representative,
            };
            const inputs = [itemToLLMInput(item)];
            const prompt = buildPrompt(inputs, "");

            const slug = `${slugify(g.representative.obs.pathKey || "root")}__${g.signature.slice(0, 8)}`;
            const file = `${slug}.txt`;
            writeFileSync(join(dir, file), prompt, "utf-8");
            indexLines.push(
                [
                    file,
                    g.signature,
                    g.representative.obs.pathKey,
                    item.action,
                    String(g.members.length),
                    String(prompt.length),
                ].join("\t"),
            );
        }

        writeFileSync(join(dir, "_index.tsv"), indexLines.join("\n") + "\n", "utf-8");
        ui.path("llm prompts dir", dir);
        ui.succeed(`wrote ${groups.length} prompt(s) to disk`);
    },
};
