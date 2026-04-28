import type { AttributeSet } from "../../types/build-type.js";

const PLACEHOLDER_MARKERS = new Set([
    "edit later",
    "edit-later",
    "tbd",
    "tba",
    "--",
    "<auto>",
    "please add relevant description",
]);

export type LeafLike = {
    required?: unknown;
    usage?: unknown;
    info?: unknown;
    owner?: unknown;
    type?: unknown;
};

/**
 * A leaf is "incomplete" when any of its core text fields is empty,
 * a known placeholder marker, or suspiciously short.
 */
export function isIncompleteLeaf(leaf: LeafLike | undefined | null): boolean {
    if (!leaf || typeof leaf !== "object") return true;
    const info = str(leaf.info);
    const usage = str(leaf.usage);
    const owner = str(leaf.owner);
    const type = str(leaf.type);

    if (!info || !usage || !owner || !type) return true;
    if (isPlaceholder(info) || isPlaceholder(usage) || isPlaceholder(owner)) return true;
    if (info.length < 15) return true;
    return false;
}

function isPlaceholder(v: string): boolean {
    return PLACEHOLDER_MARKERS.has(v.trim().toLowerCase());
}

function str(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

/**
 * Look up the _description for a given path in the real x-attributes sets.
 * path[0] is the action; subsequent segments are payload keys (NO array indices).
 * Returns the leaf description object if found, else undefined.
 */
export function lookupExistingLeaf(
    attributes: AttributeSet[],
    ucId: string,
    path: string[],
): LeafLike | undefined {
    const set =
        attributes.find((s) => s.meta?.use_case_id === ucId) ??
        attributes.find((s) => !s.meta?.use_case_id) ??
        attributes[0];
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
    return desc as LeafLike;
}
