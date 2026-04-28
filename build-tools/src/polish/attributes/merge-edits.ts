import type { AttributeSet } from "../../types/build-type.js";
import type { LeafDraft, LeafObservation } from "./types.js";

type AttrNode = Record<string, unknown>;

/**
 * Build or update an AttributeSet for `ucId` by merging approved drafts onto
 * the reconstructed tree implied by observations.
 *
 * Start from the existing attribute_set (if any) so we don't drop descriptions
 * users wrote previously; then overlay drafts at each path.
 */
export function mergeDraftsIntoAttributeSet(
    existing: AttributeSet | undefined,
    ucId: string,
    observations: LeafObservation[],
    drafts: Map<string, LeafDraft>, // keyed by `${action}::${pathKey}`
): AttributeSet {
    const attribute_set: Record<string, AttrNode> =
        (existing?.attribute_set as Record<string, AttrNode> | undefined) ?? {};

    // Ensure container nodes exist along every observed path
    for (const obs of observations) {
        ensurePath(attribute_set, obs.path);
    }

    // Apply drafts (including object-node drafts) at their paths
    for (const obs of observations) {
        const draftKey = `${obs.action}::${obs.pathKey}`;
        const draft = drafts.get(draftKey);
        if (!draft) continue;
        const leaf = getNodeAt(attribute_set, obs.path);
        if (!leaf) continue;
        leaf["_description"] = draft as unknown as Record<string, unknown>;
    }

    return { meta: { use_case_id: ucId }, attribute_set };
}

function ensurePath(root: Record<string, AttrNode>, path: string[]): void {
    let cur: Record<string, AttrNode> = root;
    for (const seg of path) {
        let next = cur[seg] as AttrNode | undefined;
        if (!next || typeof next !== "object") {
            next = {};
            cur[seg] = next;
        }
        cur = next as Record<string, AttrNode>;
    }
}

function getNodeAt(root: Record<string, AttrNode>, path: string[]): AttrNode | null {
    let cur: AttrNode | undefined = root as AttrNode;
    for (const seg of path) {
        if (!cur || typeof cur !== "object") return null;
        cur = (cur as Record<string, AttrNode>)[seg];
    }
    return cur ?? null;
}
