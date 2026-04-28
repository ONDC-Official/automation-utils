import type { KnowledgeProcessor, KnowledgeSection, ProcessorContext } from "../types.js";

export const domainOverviewProcessor: KnowledgeProcessor = {
    id: "domain-overview",
    title: "Domain Overview",

    async run(ctx: ProcessorContext): Promise<KnowledgeSection> {
        const { config, llm } = ctx;
        const { info } = config;

        const overviewContent = config["x-docs"]?.overview;

        const usecases = info["x-usecases"].join(", ");
        const description = info.description ?? "(no description provided)";
        const flowCount = config["x-flows"].length;
        const attrSetCount = config["x-attributes"].length;
        const errorCount = config["x-errorcodes"].code.length;
        const actionCount = Object.keys(config["x-supported-actions"].supportedActions).length;

        const prompt = `You are a technical documentation specialist for the ONDC (Open Network for Digital Commerce) ecosystem.

Write a concise, developer-facing overview for the following ONDC domain. Output ONLY the markdown — no preamble or meta-commentary.

## Domain Facts
- **Domain**: ${info.domain}
- **Version**: ${info.version}
- **Description**: ${description}
- **Use Cases**: ${usecases}
- **Flows**: ${flowCount}
- **Attribute Sets**: ${attrSetCount}
- **Error Codes**: ${errorCount}
- **Supported API Actions**: ${actionCount}

## Instructions
1. Open with a 2–3 sentence summary of what this domain covers and who uses it.
2. List the use cases as a bullet list with a one-sentence explanation of each.
3. Add a short "Key Concepts" section (3–5 bullets) that a new integrator needs to understand.
4. End with a "Navigation" section linking to other book sections using relative markdown links.

Start with a level-1 heading: # ${info.domain} — Domain Overview`;

        const markdown = await llm.complete([{ role: "user", content: prompt }]);

        return {
            id: "domain-overview",
            title: "Domain Overview",
            markdown,
            metadata: {
                domain: info.domain,
                version: info.version,
                usecases: info["x-usecases"],
            },
        };
    },
};
