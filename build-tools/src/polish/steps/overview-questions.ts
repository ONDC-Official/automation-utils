import { input } from "@inquirer/prompts";
import type { PolishStep } from "../types.js";

export type OverviewAnswers = {
    sector: string;
    problem: string;
    realWorldActors: string;
    usecases: string;
    concepts: string;
    examples: string;
};

export const overviewQuestionsStep: PolishStep = {
    id: "overview-questions",
    title: "Collect guided answers for overview",
    async run(ctx) {
        const { ui } = ctx;
        if (!ctx.state["overviewGap"]) {
            ui.info("no overview gap — skipping");
            return;
        }

        const { config } = ctx;
        const useCaseHint = (config.info["x-usecases"] ?? []).join(", ");

        ui.pauseForInteraction();
        ui.hint(`answering 6 short questions — keep them brief, LLM will expand`);

        const sector = await input({
            message:
                '1/6 Sector / industry this domain serves (e.g. "personal lending", "logistics", "retail-grocery"):',
            validate: (v) => v.trim().length > 0 || "required",
        });
        const problem = await input({
            message: "2/6 One-line: what problem does this domain solve?",
            validate: (v) => v.trim().length > 0 || "required",
        });
        const realWorldActors = await input({
            message:
                '3/6 Who actually transacts in real life (e.g. "banks ↔ loan service providers", "consumers ↔ kirana stores")?',
            validate: (v) => v.trim().length > 0 || "required",
        });
        const usecases = await input({
            message: `4/6 Key use cases (default: ${useCaseHint || "none declared"}):`,
            default: useCaseHint,
        });
        const concepts = await input({
            message: "5/6 3-5 key domain concepts (comma-separated):",
            validate: (v) => v.trim().length > 0 || "required",
        });
        const examples = await input({
            message: "6/6 Concrete real-world example or scenario (1-2 sentences):",
            validate: (v) => v.trim().length > 0 || "required",
        });

        const answers: OverviewAnswers = {
            sector,
            problem,
            realWorldActors,
            usecases,
            concepts,
            examples,
        };
        ctx.state["overviewAnswers"] = answers;
        ui.succeed("captured 6 answers");
    },
};
