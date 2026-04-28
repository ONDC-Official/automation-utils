import type { BuildConfig } from "../../types/build-type.js";
import type { LeafObservation } from "./types.js";

type FlowCfg = {
    steps?: Array<{
        api?: string;
        action_id?: string;
        mock?: { defaultPayload?: unknown };
        examples?: Array<{ payload?: unknown }>;
    }>;
    transaction_history?: Array<{ action?: string; payload?: unknown }>;
};

const MAX_SAMPLES = 5;

/**
 * Walk every flow payload (mock.defaultPayload, examples, transaction_history)
 * and emit one LeafObservation per distinct (usecase, action, pathKey) where
 * a primitive value or an object node was observed.
 *
 * Object nodes get observations too (isLeaf=false) so downstream can describe
 * composite attributes; leaf observations (isLeaf=true) carry sample values.
 */
export function walkFlowsForObservations(config: BuildConfig): LeafObservation[] {
    // keyed by `${ucId}::${action}::${pathKey}`
    const map = new Map<string, LeafObservation>();
    // parallel counts: same key → Map<jsonStringifiedValue, {value, count}>
    const counts = new Map<string, Map<string, { value: unknown; count: number }>>();

    for (const flow of config["x-flows"] ?? []) {
        const ucId = flow.usecase;
        const flowId = flow.id;
        const cfg = flow.config as FlowCfg | undefined;

        for (const step of cfg?.steps ?? []) {
            const action = step.api;
            if (!action) continue;

            if (step.mock?.defaultPayload !== undefined && step.mock.defaultPayload !== null) {
                walk(step.mock.defaultPayload, [action], ucId, flowId, action, map, counts, false);
            }
            for (const ex of step.examples ?? []) {
                if (ex.payload !== undefined && ex.payload !== null) {
                    walk(ex.payload, [action], ucId, flowId, action, map, counts, false);
                }
            }
        }
        for (const entry of cfg?.transaction_history ?? []) {
            if (!entry.action || entry.payload === undefined || entry.payload === null) continue;
            walk(entry.payload, [entry.action], ucId, flowId, entry.action, map, counts, false);
        }
    }

    // Finalize sampleCounts + mostCommonValue from per-key counters
    for (const [key, obs] of map) {
        const counter = counts.get(key);
        if (!counter || counter.size === 0) continue;
        const arr = Array.from(counter.values()).sort((a, b) => b.count - a.count);
        obs.sampleCounts = arr;
        obs.mostCommonValue = arr[0]!.value;
    }

    return Array.from(map.values());
}

function walk(
    value: unknown,
    path: string[],
    ucId: string,
    flowId: string,
    action: string,
    out: Map<string, LeafObservation>,
    counts: Map<string, Map<string, { value: unknown; count: number }>>,
    crossedArray: boolean,
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            walk(item, path, ucId, flowId, action, out, counts, true);
        }
        return;
    }

    const pathKey = path.slice(1).join("."); // drop action prefix
    const key = `${ucId}::${action}::${pathKey}`;

    if (value === null || typeof value !== "object") {
        const existing = out.get(key);
        bumpCount(counts, key, value);
        if (existing) {
            if (!existing.seenInFlows.includes(flowId)) existing.seenInFlows.push(flowId);
            if (
                existing.sampleValues.length < MAX_SAMPLES &&
                !existing.sampleValues.includes(value)
            ) {
                existing.sampleValues.push(value);
            }
            if (crossedArray) existing.isArrayIndexed = true;
            return;
        }
        out.set(key, {
            ucId,
            action,
            path: [...path],
            pathKey,
            valueType: value === null ? "null" : typeof value,
            sampleValues: [value],
            isLeaf: true,
            seenInFlows: [flowId],
            isArrayIndexed: crossedArray,
        });
        return;
    }

    // object
    const existing = out.get(key);
    if (!existing) {
        out.set(key, {
            ucId,
            action,
            path: [...path],
            pathKey,
            valueType: "object",
            sampleValues: [],
            isLeaf: false,
            seenInFlows: [flowId],
            isArrayIndexed: crossedArray,
        });
    } else if (!existing.seenInFlows.includes(flowId)) {
        existing.seenInFlows.push(flowId);
    }

    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, [...path, k], ucId, flowId, action, out, counts, crossedArray);
    }
}

function bumpCount(
    counts: Map<string, Map<string, { value: unknown; count: number }>>,
    key: string,
    value: unknown,
): void {
    let c = counts.get(key);
    if (!c) {
        c = new Map();
        counts.set(key, c);
    }
    const k = JSON.stringify(value);
    const cur = c.get(k);
    if (cur) cur.count += 1;
    else c.set(k, { value, count: 1 });
}
