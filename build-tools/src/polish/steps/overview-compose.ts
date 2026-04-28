import type { PolishStep } from "../types.js";
import type { OverviewAnswers } from "./overview-questions.js";

export const overviewComposeStep: PolishStep = {
    id: "overview-compose",
    title: "Compose overview via LLM",
    async run(ctx) {
        const { ui } = ctx;
        if (!ctx.state["overviewGap"]) {
            ui.info("no overview gap — skipping");
            return;
        }
        const answers = ctx.state["overviewAnswers"] as OverviewAnswers | undefined;
        if (!answers) {
            throw new Error("missing answers from overview-questions step");
        }

        const { config, llm } = ctx;
        const domain = config.info.domain;
        const version = config.info.version;
        const declaredUsecases =
            (config.info["x-usecases"] ?? []).join(", ") || "(none)";
        const flowCount = config["x-flows"]?.length ?? 0;
        const flowIds = (config["x-flows"] ?? [])
            .map((f) => `- ${f.id} (${f.usecase}): ${f.description}`)
            .join("\n");
        const actionCount = Object.keys(
            (config["x-supported-actions"] as { supportedActions?: Record<string, unknown> })
                ?.supportedActions ?? {},
        ).length;

        const prompt = `You are a technical documentation specialist writing the domain overview for an ONDC build config.

Write so a developer new to ONDC understands what this domain does in the real economy before any technical detail. Lead with the sector, what's being transacted, and who transacts — not protocol mechanics.

Compose the overview as a single markdown document. Start with the heading exactly:
# ${domain} ${version} — Overview

Include these sections (use \`##\` subheadings, in this order):
- Summary (2-3 sentences, plain language — what this domain is and what it enables)
- Sector & Purpose (the industry/sector and the problem solved)
- Real-World Actors (the businesses/people who actually transact, in plain terms — not BAP/BPP boilerplate)
- Use Cases (bulleted)
- Key Concepts (bulleted, 3-5 items)
- Example Scenario (a concrete walkthrough grounded in the author's example)

Use the author's answers verbatim where possible; expand with domain-appropriate phrasing. Do not invent facts outside the provided context. No trailing metadata, no code fences around the whole doc.

---
Domain: ${domain}
Version: ${version}
Declared usecases: ${declaredUsecases}
Flow count: ${flowCount}
Action count: ${actionCount}
Flows:
${flowIds || "(none)"}

Author answers:
1. Sector / industry:
${answers.sector}
2. Problem this domain solves:
${answers.problem}
3. Real-world actors who transact:
${answers.realWorldActors}
4. Key use cases:
${answers.usecases}
5. Key concepts an integrator must understand:
${answers.concepts}
6. Concrete real-world example or scenario:
${answers.examples}
`;

        ui.spin("composing overview with LLM");
        const markdown = await llm.complete([{ role: "user", content: prompt }]);
        ctx.state["overviewMarkdown"] = markdown.trim() + "\n";
        ui.succeed(`composed overview (${markdown.length} chars)`);
    },
};
