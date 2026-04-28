import { input } from "@inquirer/prompts";
import type { PolishStep } from "../types.js";

export type OverviewAnswers = {
    problem: string;
    participants: string;
    usecases: string;
    concepts: string;
    deviations: string;
    references: string;
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

        const problem = await input({
            message: "1/6 One-line: what problem does this domain solve?",
            validate: (v) => v.trim().length > 0 || "required",
        });
        const participants = await input({
            message: "2/6 Primary participants (BAP/BPP + domain roles):",
            validate: (v) => v.trim().length > 0 || "required",
        });
        const usecases = await input({
            message: `3/6 Key use cases (default: ${useCaseHint || "none declared"}):`,
            default: useCaseHint,
        });
        const concepts = await input({
            message: "4/6 3-5 key domain concepts (comma-separated):",
            validate: (v) => v.trim().length > 0 || "required",
        });
        const deviations = await input({
            message: "5/6 Deviations from stock ONDC (or 'none'):",
            default: "none",
        });
        const references = await input({
            message: "6/6 References / out-of-scope items (or blank):",
            default: "",
        });

        const answers: OverviewAnswers = {
            problem,
            participants,
            usecases,
            concepts,
            deviations,
            references,
        };
        ctx.state["overviewAnswers"] = answers;
        ui.succeed("captured 6 answers");
    },
};
