import type {
    NewAttributeLeaf,
    NewAttributeValue,
    NewAttributes,
} from "../types/new-build.js";
import type {
    OldAttributeEntry,
    OldAttributeValue,
    OldAttributes,
    OldEnumEntry,
    OldEnumValue,
    OldEnums,
    OldTagEntry,
    OldTagValue,
    OldTags,
} from "../types/old-build.js";
import type { KbLookup } from "./knowledgebase.js";

const NO_KB: KbLookup = () => undefined;

// ─── Helper: detect an OldAttributeEntry leaf ────────────────────────────────
//
// A leaf node always carries `required` as a primitive string value.
// Containers have sub-keys that are themselves OldAttributeValues (objects).
// build.yaml-style entries may omit `type`/`owner` but still have `required`
// or at minimum `description` + `usage`.
function isOldLeaf(v: unknown): v is OldAttributeEntry {
    if (typeof v !== "object" || v === null) return false;
    const obj = v as Record<string, unknown>;
    return (
        typeof obj["required"] === "string" ||
        (typeof obj["description"] === "string" &&
            typeof obj["usage"] === "string")
    );
}

// ─── Helper: normalise "mandatory"/"Required"/etc. to boolean ────────────────
function parseRequired(val: string | undefined): boolean {
    if (!val) return false;
    const lower = val.toLowerCase().trim();
    return (
        lower !== "optional" &&
        lower !== "no" &&
        lower !== "false" &&
        lower !== "not required"
    );
}

// ─── Helper: build a NewAttributeLeaf from old data + merged enum/tag info ───
function convertLeaf(
    entry: OldAttributeEntry,
    enums: OldEnumEntry[] | undefined,
    tags: OldTagEntry[] | undefined,
    kbLookup: KbLookup,
    attrSuffix: string,
): NewAttributeLeaf {
    const hasEnums = enums != null && enums.length > 0;
    const hasTags = tags != null && tags.length > 0;

    const leaf: NewAttributeLeaf = {
        required: parseRequired(entry.required),
        usage: entry.usage ?? "--",
        info:
            entry.description ??
            kbLookup(attrSuffix) ??
            "<placeholder description>",
        owner: entry.owner ?? "BAP",
        type: entry.type ?? (hasEnums ? "enum" : "string"),
    };

    if (hasEnums) {
        leaf.enums = enums;
        // Promote to "enum" type when no explicit type was given
        if (!entry.type || entry.type === "string") leaf.type = "enum";
    }

    if (hasTags) {
        leaf.tags = convertTagEntries(tags!);
    }

    return leaf;
}

// ─── Helper: convert OldTagEntry[] → new tags array shape ───────────────────
function convertTagEntries(
    entries: OldTagEntry[],
): NonNullable<NewAttributeLeaf["tags"]> {
    return entries.map((tag) => ({
        code: tag.code,
        _description: {
            required: false,
            usage: "--",
            info: tag.description ?? "<placeholder tag description>",
            owner: "BAP",
            type: "string",
        } satisfies NewAttributeLeaf,
        ...(tag.list != null &&
            tag.list.length > 0 && {
                list: tag.list.map((item) => ({
                    code: item.code,
                    _description: {
                        required: false,
                        usage: "--",
                        info:
                            item.description ??
                            "<placeholder tag list item description>",
                        owner: "BAP",
                        type: "string",
                    } satisfies NewAttributeLeaf,
                })),
            }),
    }));
}

// ─── Core: recursively convert an OldAttributeValue subtree ─────────────────
//
// enumNode  – the x-enum subtree at the same path as attrNode
// tagNode   – the x-tags subtree at the same path as attrNode
//
// Rules
//   • Leaf  → { _description: NewAttributeLeaf }
//   • Container:
//       - Non-"_description" keys → recurse, descending both enum/tag trees
//       - "_description" key      → convertLeaf, stays as _description
//       - Primitives (parent:true etc.) → skipped
//   • Enums merge at a leaf when enumNode is an array at that path
//   • Tags  merge at _description when tagNode is an array at that path
//     (the x-tags path includes the "tags" attribute key itself, so by the
//      time we are inside that container tagNode is already the array)
function convertAttributeNode(
    attrNode: OldAttributeValue,
    enumNode: OldEnumValue | undefined,
    tagNode: OldTagValue | undefined,
    kbLookup: KbLookup,
    pathParts: string[],
): NewAttributeValue {
    const attrSuffix = pathParts.join(".");

    if (isOldLeaf(attrNode)) {
        // Bare leaf → wrap in _description
        const enums = Array.isArray(enumNode)
            ? (enumNode as OldEnumEntry[])
            : undefined;
        const tags = Array.isArray(tagNode)
            ? (tagNode as OldTagEntry[])
            : undefined;
        return {
            _description: convertLeaf(
                attrNode,
                enums,
                tags,
                kbLookup,
                attrSuffix,
            ),
        };
    }

    // Container: iterate every child key
    const container = attrNode as Record<string, OldAttributeValue>;
    const result: Record<string, NewAttributeValue> = {};

    for (const key of Object.keys(container)) {
        const childAttr = container[key];

        // Skip primitive markers such as `parent: true` in build.yaml
        if (typeof childAttr !== "object" || childAttr === null) continue;

        if (key === "_description") {
            // Explicit container description – convert leaf and keep as _description.
            // Enums/tags apply here only when the parent already resolved them to arrays
            // (i.e. when this container IS the enum/tag endpoint itself – rare).
            const enums = Array.isArray(enumNode)
                ? (enumNode as OldEnumEntry[])
                : undefined;
            const tags = Array.isArray(tagNode)
                ? (tagNode as OldTagEntry[])
                : undefined;
            result["_description"] = convertLeaf(
                childAttr as OldAttributeEntry,
                enums,
                tags,
                kbLookup,
                attrSuffix,
            );
        } else {
            // Descend into both enum and tag trees in parallel
            const childEnum =
                enumNode != null && !Array.isArray(enumNode)
                    ? (enumNode as Record<string, OldEnumValue>)[key]
                    : undefined;

            const childTag =
                tagNode != null && !Array.isArray(tagNode)
                    ? (tagNode as Record<string, OldTagValue>)[key]
                    : undefined;

            result[key] = convertAttributeNode(
                childAttr,
                childEnum,
                childTag,
                kbLookup,
                [...pathParts, key],
            );
        }
    }

    // Every container in the new format must have a `_description` with type "object".
    // When the old format omitted it, synthesize one — pulling info from the KB
    // first, falling back to a placeholder when nothing is found.
    if (!("_description" in result)) {
        result["_description"] = {
            required: false,
            usage: "--",
            info: kbLookup(attrSuffix) ?? "<placeholder description>",
            owner: "BAP",
            type: "object",
        } satisfies NewAttributeLeaf;
    }

    return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert one use-case worth of old x-attributes / x-tags / x-enum data into
 * a NewAttributes entry (one element of the new x-attributes array).
 *
 * Algorithm overview
 * ──────────────────
 * 1. Look up the use-case inside OldAttributes.
 * 2. For every action in its attribute_set:
 *    a. Walk the old attribute tree recursively.
 *    b. At each path, simultaneously descend the x-enum and x-tags trees.
 *    c. Leaf nodes  → wrapped in { _description: NewAttributeLeaf }
 *       Container nodes → recurse; convert any _description sub-key as leaf.
 *    d. When the enum sub-tree at a leaf is an array → set leaf.enums.
 *    e. When the tag  sub-tree at a leaf is an array → set leaf.tags
 *       (the "tags" key in x-attributes maps 1-to-1 with the "tags" path in x-tags,
 *        so tagNode is the array by the time the _description of that node is built).
 * 3. Wrap everything in { meta: { use_case_id }, attribute_set }.
 */
export function attributeConverter(
    attributes: OldAttributes,
    tags: OldTags,
    enums: OldEnums,
    useCaseId: string,
    kbLookup: KbLookup = NO_KB,
): NewAttributes {
    const useCaseData = attributes[useCaseId];
    if (!useCaseData?.attribute_set) {
        return { meta: { use_case_id: useCaseId } };
    }

    const attribute_set: Record<string, NewAttributeValue> = {};

    for (const action of Object.keys(useCaseData.attribute_set)) {
        const attrNode = useCaseData.attribute_set[action];
        if (attrNode == null) continue;

        attribute_set[action] = convertAttributeNode(
            attrNode,
            enums[action],
            tags[action],
            kbLookup,
            [action],
        );
    }

    return {
        meta: { use_case_id: useCaseId },
        attribute_set,
    };
}
