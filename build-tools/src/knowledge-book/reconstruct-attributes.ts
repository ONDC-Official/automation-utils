import type { AttributeSet, BuildConfig } from "../types/build-type.js";

type Json = unknown;
type AttrNode = Record<string, unknown>;

type LeafDescription = {
    required: unknown;
    usage: string;
    info: string;
    owner: string;
    type: string;
    enums?: unknown;
    enumrefs?: unknown;
    tags?: unknown;
};

const DUMMY_LEAF: LeafDescription = {
    required: false,
    usage: "edit later",
    info: "edit later",
    owner: "edit later",
    type: "edit later",
};

const DUMMY_OBJECT: LeafDescription = {
    required: false,
    usage: "--",
    info: "edit later",
    owner: "edit later",
    type: "object",
};

/**
 * Walk every example payload in `x-flows` and reconstruct an `x-attributes`
 * structure that mirrors the payload shape. For each node, descriptions and
 * enums are pulled from the real `x-attributes` when available; otherwise a
 * placeholder "edit later" leaf is emitted.
 *
 * Output is grouped by use case (flow.usecase) → action (step.api) and
 * returned as an `AttributeSet[]` compatible with BuildConfig["x-attributes"].
 */
export function reconstructAttributesFromExamples(config: BuildConfig): AttributeSet[] {
    const realSets = config["x-attributes"] ?? [];
    const byUseCase = new Map<string, Map<string, AttrNode>>();

    for (const flow of config["x-flows"] ?? []) {
        const ucId = flow.usecase;
        if (!byUseCase.has(ucId)) byUseCase.set(ucId, new Map());
        const actionMap = byUseCase.get(ucId)!;

        const cfg = flow.config as {
            steps?: unknown[];
            transaction_history?: { action?: string; payload?: Json }[];
        } | undefined;

        const steps = cfg?.steps ?? [];
        for (const rawStep of steps) {
            const step = rawStep as {
                api?: string;
                examples?: { payload?: Json }[];
            };
            const action = step.api;
            if (!action || !step.examples) continue;

            for (const ex of step.examples) {
                if (ex.payload === undefined || ex.payload === null) continue;
                if (!actionMap.has(action)) actionMap.set(action, {});
                mergePayload(ex.payload, actionMap.get(action)!, [action], ucId, realSets);
            }
        }

        for (const entry of cfg?.transaction_history ?? []) {
            const action = entry.action;
            if (!action || entry.payload === undefined || entry.payload === null) continue;
            if (!actionMap.has(action)) actionMap.set(action, {});
            mergePayload(entry.payload, actionMap.get(action)!, [action], ucId, realSets);
        }
    }

    const out: AttributeSet[] = [];
    for (const [ucId, actionMap] of byUseCase) {
        const attribute_set: Record<string, AttrNode> = {};
        for (const [action, tree] of actionMap) attribute_set[action] = tree;
        out.push({ meta: { use_case_id: ucId }, attribute_set });
    }
    return out;
}

function mergePayload(
    payload: Json,
    tree: AttrNode,
    path: string[],
    ucId: string,
    realSets: AttributeSet[],
): void {
    if (Array.isArray(payload)) {
        for (const item of payload) mergePayload(item, tree, path, ucId, realSets);
        return;
    }

    if (payload === null || typeof payload !== "object") {
        if (!tree["_description"]) {
            tree["_description"] = lookupLeaf(path, ucId, realSets) ?? {
                ...DUMMY_LEAF,
                usage: String(payload),
                type: typeof payload,
            };
        }
        return;
    }

    for (const [key, value] of Object.entries(payload as Record<string, Json>)) {
        if (key === "_description") continue;
        let child = tree[key] as AttrNode | undefined;
        if (!child || typeof child !== "object") {
            child = {};
            tree[key] = child;
        }
        mergePayload(value, child, [...path, key], ucId, realSets);
    }

    // Own _description for this object node — skip at the action (root) level
    // to match the convention that actions themselves may or may not carry one;
    // we add it so consumers always have a node description.
    if (!tree["_description"]) {
        tree["_description"] = lookupLeaf(path, ucId, realSets) ?? { ...DUMMY_OBJECT };
    }
}

/**
 * Find the `_description` object for `path` inside the real x-attributes.
 * `path[0]` is the action; the rest are payload keys. Returns undefined if any
 * segment is missing.
 */
function lookupLeaf(
    path: string[],
    ucId: string,
    realSets: AttributeSet[],
): LeafDescription | undefined {
    const set =
        realSets.find((s) => s.meta?.use_case_id === ucId) ??
        realSets.find((s) => !s.meta?.use_case_id) ??
        realSets[0];
    if (!set?.attribute_set) return undefined;

    let node: unknown = set.attribute_set;
    for (const seg of path) {
        if (!node || typeof node !== "object") return undefined;
        node = (node as Record<string, unknown>)[seg];
        if (node === undefined) return undefined;
    }
    if (!node || typeof node !== "object") return undefined;
    const desc = (node as Record<string, unknown>)["_description"];
    if (!desc || typeof desc !== "object") return undefined;
    return desc as LeafDescription;
}
