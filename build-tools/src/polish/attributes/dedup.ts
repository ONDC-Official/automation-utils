import { createHash } from "crypto";
import type {
    BundleRef,
    ContextBundle,
    DedupGroup,
    EnumEntry,
    TagEntry,
} from "./types.js";

function sha(s: string): string {
    return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function enumShape(arr?: EnumEntry[]): string[] {
    if (!arr) return [];
    return arr.map((e) => e.code);
}

function tagShape(arr?: TagEntry[]): unknown[] {
    if (!arr) return [];
    return arr.map((t) => ({
        code: t.code,
        list: (t.list ?? []).map((l) => l.code).sort(),
    }));
}

export function computeSignature(b: ContextBundle): string {
    const payload = {
        pathKey: b.obs.pathKey,
        valueType: b.obs.valueType,
        isLeaf: b.obs.isLeaf,
        openapi: b.openapi
            ? {
                  description: b.openapi.description ?? "",
                  custom: b.openapi.customDescription ?? null,
                  type: b.openapi.type ?? "",
              }
            : null,
        existingEnums: enumShape(b.existing?.enums),
        existingTags: tagShape(b.existing?.tags),
    };
    return sha(JSON.stringify(payload));
}

export function computeRefFingerprint(b: ContextBundle): string {
    const refKinds = Array.from(new Set(b.refs.map((r) => r.kind))).sort();
    const saveTails = Array.from(
        new Set(b.saveData.map((s) => s.jsonpath.split(".").slice(-2).join("."))),
    ).sort();
    return sha(JSON.stringify({ refKinds, saveTails }));
}

export function deriveOwner(action: string): "BAP" | "BPP" {
    return action.startsWith("on_") ? "BPP" : "BAP";
}

export function deriveRequired(b: ContextBundle, totalFlowsForAction: number): boolean {
    if (totalFlowsForAction <= 0) return false;
    return b.obs.seenInFlows.length >= totalFlowsForAction;
}

export type LeafType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "enum"
    | "date-time";

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function deriveUsage(b: ContextBundle): string {
    if (b.obs.isLeaf === false) return "";
    const pick = (v: unknown): string => {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v;
        return JSON.stringify(v);
    };
    if (b.obs.mostCommonValue !== undefined && b.obs.mostCommonValue !== null) {
        return pick(b.obs.mostCommonValue);
    }
    for (const v of b.obs.sampleValues) {
        if (v !== null && v !== undefined) return pick(v);
    }
    return "";
}

export function deriveType(b: ContextBundle): LeafType {
    if (b.existing?.enums && b.existing.enums.length > 0) return "enum";
    if (b.obs.isLeaf === false) return "object";

    const candidate = b.obs.mostCommonValue ?? b.obs.sampleValues.find((v) => v != null);
    if (typeof candidate === "string" && ISO_8601_RE.test(candidate)) return "date-time";

    const vt = b.obs.valueType;
    if (vt === "string" || vt === "number" || vt === "boolean") return vt;
    return "string";
}

export function groupBundles(allBundles: BundleRef[]): DedupGroup[] {
    const map = new Map<string, DedupGroup>();
    for (const ref of allBundles) {
        const sig = computeSignature(ref.bundle);
        const fp = computeRefFingerprint(ref.bundle);
        const key = `${sig}::${fp}`;
        let g = map.get(key);
        if (!g) {
            g = {
                signature: sig,
                refFingerprint: fp,
                representative: ref.bundle,
                members: [],
            };
            map.set(key, g);
        }
        g.members.push(ref);
    }
    return Array.from(map.values());
}
