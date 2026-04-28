import type { BuildConfig, AttributeSet } from "../../types/build-type.js";
import type { FlowStepRef, FlowLevelRef } from "./types.js";

type RawStep = {
    api?: string;
    action_id?: string;
    owner?: string;
    responseFor?: string | null;
    unsolicited?: boolean;
    description?: string;
    mock?: {
        saveData?: Record<string, string>;
    };
};

type RawFlowConfig = { steps?: RawStep[] };

/**
 * Walk every flow step and build a FlowStepRef. We no longer decode mock JS
 * (generate/validate/requirements) because phase 3 now drafts only
 * descriptions.
 */
export function collectStepRefs(config: BuildConfig): FlowStepRef[] {
    const out: FlowStepRef[] = [];
    for (const flow of config["x-flows"] ?? []) {
        const cfg = flow.config as RawFlowConfig | undefined;
        const steps = cfg?.steps ?? [];
        const prevKeys: string[] = [];
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i]!;
            const action = s.api ?? "";
            if (!action) continue;
            const saveData =
                s.mock?.saveData && typeof s.mock.saveData === "object"
                    ? (s.mock.saveData as Record<string, string>)
                    : {};
            out.push({
                flowId: flow.id,
                usecase: flow.usecase,
                stepIndex: i,
                action,
                actionId: s.action_id ?? action,
                owner: s.owner ?? "unknown",
                responseFor: s.responseFor ?? null,
                unsolicited: Boolean(s.unsolicited),
                currentDescription: s.description ?? "",
                saveData,
                prevSaveDataKeys: [...prevKeys],
            });
            for (const k of Object.keys(saveData)) if (!prevKeys.includes(k)) prevKeys.push(k);
        }
    }
    return out;
}

/**
 * One FlowLevelRef per flow entry in x-flows. Carries just enough context for
 * the LLM to draft a 1-2 sentence flow description.
 */
export function collectFlowRefs(config: BuildConfig): FlowLevelRef[] {
    const out: FlowLevelRef[] = [];
    for (const flow of config["x-flows"] ?? []) {
        const cfg = flow.config as RawFlowConfig | undefined;
        const steps = cfg?.steps ?? [];
        const actionSummary = steps
            .map((s) => s.api ?? "")
            .filter((a) => a.length > 0);
        out.push({
            flowId: flow.id,
            usecase: flow.usecase,
            tags: flow.tags ?? [],
            currentDescription: flow.description ?? "",
            stepCount: steps.length,
            actionSummary,
        });
    }
    return out;
}

export function getActionAttributeSubtree(
    attributes: AttributeSet[],
    ucId: string,
    action: string,
): unknown {
    const set =
        attributes.find((s) => s.meta?.use_case_id === ucId) ??
        attributes.find((s) => !s.meta?.use_case_id) ??
        attributes[0];
    if (!set?.attribute_set) return null;
    const node = (set.attribute_set as Record<string, unknown>)[action];
    return node ?? null;
}
