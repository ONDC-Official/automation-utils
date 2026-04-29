import type { PolishStep } from "../types.js";
import { collectFlowRefs, collectStepRefs } from "../flows/context.js";
import type { FlowStepRef, FlowLevelRef } from "../flows/types.js";
import { BuildConfig } from "../../types/build-type.js";
import { loadSplitConfig } from "../../commands/merge.js";

export type FlowDescNeeders = {
    flows: FlowLevelRef[];
    steps: FlowStepRef[];
};

export const flowsDetectStep: PolishStep = {
    id: "flows-detect",
    title: "Collect flow/step descriptions to draft",
    async run(ctx) {
        const { ui } = ctx;

        ui.spin("loading merged config from output dir");
        let effective = ctx.config;
        try {
            const merged = loadSplitConfig(ctx.outputDir);
            const parsed = BuildConfig.safeParse(merged);
            if (parsed.success) effective = parsed.data;
        } catch {
            // stick with ctx.config
        }
        ctx.state["flowsEffectiveConfig"] = effective;

        ui.spin("collecting all flows + steps");
        const allFlows = collectFlowRefs(effective);
        const allSteps = collectStepRefs(effective);

        const flowNeeders = allFlows;
        const stepNeeders = allSteps;

        ui.stat("flows total", allFlows.length);
        ui.stat("steps total", allSteps.length);

        const limitRaw = process.env["POLISH_FLOW_LIMIT"];
        let flows = flowNeeders;
        let steps = stepNeeders;
        if (limitRaw) {
            const n = Number(limitRaw);
            if (Number.isFinite(n) && n > 0) {
                if (flows.length > n) flows = flows.slice(0, n);
                if (steps.length > n) steps = steps.slice(0, n);
                ui.warn(
                    `POLISH_FLOW_LIMIT=${n} — capped to ${flows.length} flow(s) + ${steps.length} step(s) for test`,
                );
            }
        }

        const needers: FlowDescNeeders = { flows, steps };
        ctx.state["flowDescNeeders"] = needers;

        const total = flows.length + steps.length;
        if (total === 0) {
            ui.succeed("no stub descriptions — nothing to draft");
        } else {
            ui.succeed(`will draft ${flows.length} flow + ${steps.length} step description(s)`);
        }
    },
};
