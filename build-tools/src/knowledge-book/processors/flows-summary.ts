import type { KnowledgeProcessor, KnowledgeSection, ProcessorContext } from "../types.js";

export const flowsSummaryProcessor: KnowledgeProcessor = {
    id: "flows-summary",
    title: "Flows Summary",

    async run(ctx: ProcessorContext): Promise<KnowledgeSection> {
        const { config, llm } = ctx;
        const flows = config["x-flows"];

        const byUseCase = new Map<string, typeof flows>();
        for (const flow of flows) {
            if (!byUseCase.has(flow.usecase)) byUseCase.set(flow.usecase, []);
            byUseCase.get(flow.usecase)!.push(flow);
        }

        const flowsText = [...byUseCase.entries()]
            .map(([uc, ucFlows]) => {
                const lines = ucFlows.map(
                    (f) => `  - \`${f.id}\` (tags: ${f.tags.join(", ")}): ${f.description}`,
                );
                return `### ${uc}\n${lines.join("\n")}`;
            })
            .join("\n\n");

        const prompt = `You are a technical documentation specialist for ONDC.

Write a structured summary of the API flows for "${config.info.domain} ${config.info.version}".
Output ONLY markdown — no preamble.

## Flows by Use Case
${flowsText}

## Instructions
- Start with "# Flows Summary" as the h1 heading.
- For each use case group, write a short paragraph (2–3 sentences) explaining the business purpose.
- List each flow as a bullet with its ID in backticks, a colon, then a plain-English description.
- End with a "Common Patterns" section highlighting any shared sequences or conventions.`;

        const markdown = await llm.complete([{ role: "user", content: prompt }]);

        return {
            id: "flows-summary",
            title: "Flows Summary",
            markdown,
            metadata: { flowCount: flows.length, usecases: [...byUseCase.keys()] },
        };
    },
};
