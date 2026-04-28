import type { PolishStep } from "../types.js";
import type { BuildConfig } from "../../types/build-type.js";
import type { FlowLevelRef, FlowStepRef } from "../flows/types.js";
import { draftFlowDescription, draftStepDescription } from "../flows/draft.js";
import { getActionAttributeSubtree } from "../flows/context.js";
import { getConcurrency, runWithConcurrency } from "../review/concurrency.js";
import type { FlowDescNeeders } from "./flows-detect.js";

export type FlowDescDraft =
    | { kind: "flow"; ref: FlowLevelRef; description: string; error?: string }
    | { kind: "step"; ref: FlowStepRef; description: string; error?: string };

export const flowsDraftStep: PolishStep = {
    id: "flows-draft",
    title: "LLM-draft flow and step descriptions",
    async run(ctx) {
        const { ui } = ctx;
        const needers = ctx.state["flowDescNeeders"] as FlowDescNeeders | undefined;
        const effective =
            (ctx.state["flowsEffectiveConfig"] as BuildConfig | undefined) ?? ctx.config;
        if (!needers || needers.flows.length + needers.steps.length === 0) {
            ui.info("nothing to draft — skipping");
            return;
        }

        const flowDescByFlowId = new Map<string, string>();
        for (const f of effective["x-flows"] ?? []) flowDescByFlowId.set(f.id, f.description ?? "");
        const attributes = effective["x-attributes"] ?? [];

        type Task =
            | { kind: "flow"; ref: FlowLevelRef }
            | { kind: "step"; ref: FlowStepRef };
        const tasks: Task[] = [
            ...needers.flows.map((r) => ({ kind: "flow", ref: r }) as Task),
            ...needers.steps.map((r) => ({ kind: "step", ref: r }) as Task),
        ];

        const limit = getConcurrency();
        ui.info(
            `drafting ${needers.flows.length} flow + ${needers.steps.length} step description(s) — concurrency ${limit}`,
        );
        ui.spin(`[0/${tasks.length}] drafting descriptions`);

        const results = await runWithConcurrency<Task, FlowDescDraft>(
            tasks,
            limit,
            async (task) => {
                try {
                    if (task.kind === "flow") {
                        const description = await draftFlowDescription(ctx.llm, task.ref);
                        return { kind: "flow", ref: task.ref, description };
                    }
                    const subtree = getActionAttributeSubtree(
                        attributes,
                        task.ref.usecase,
                        task.ref.action,
                    );
                    const description = await draftStepDescription(ctx.llm, {
                        ref: task.ref,
                        attributeSubtree: subtree,
                        flowDescription: flowDescByFlowId.get(task.ref.flowId) ?? "",
                    });
                    return { kind: "step", ref: task.ref, description };
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (task.kind === "flow") {
                        return { kind: "flow", ref: task.ref, description: "", error: msg };
                    }
                    return { kind: "step", ref: task.ref, description: "", error: msg };
                }
            },
            (done) => ui.update(`[${done}/${tasks.length}] drafted`),
        );

        const errorCount = results.filter((r) => r.error).length;
        ui.succeed(
            `drafted ${results.length - errorCount} description(s)${errorCount ? ` · ${errorCount} error(s)` : ""}`,
        );
        ctx.state["flowDescDrafts"] = results;
    },
};
