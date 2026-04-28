import type { BuildConfig } from "../../types/build-type.js";
import type { OpenApiMetadata } from "./types.js";

type Schema = Record<string, unknown>;
type Pointer = (string | number)[];

/**
 * Look up OpenAPI metadata for [action, ...segments]. Finds the requestBody
 * schema for `/action` (post) in `paths`, resolves $ref/allOf/oneOf/anyOf,
 * and walks segments through `properties`. Numeric segments descend into
 * `items` (arrays). Returns merged description/_description/type/enum.
 */
export function lookupOpenApi(
    config: BuildConfig,
    action: string,
    segments: string[],
): OpenApiMetadata | null {
    const paths = config.paths as Record<string, unknown> | undefined;
    if (!paths) return null;

    const pathKey = `/${action}`;
    const pathItem = paths[pathKey] as Record<string, unknown> | undefined;
    if (!pathItem) return null;

    const post = pathItem["post"] as Record<string, unknown> | undefined;
    if (!post) return null;

    const requestBody = post["requestBody"] as Record<string, unknown> | undefined;
    const content = requestBody?.["content"] as Record<string, unknown> | undefined;
    const appJson = content?.["application/json"] as Record<string, unknown> | undefined;
    const schema = appJson?.["schema"] as Schema | undefined;
    if (!schema) return null;

    const leaf = walkSchema(schema, segments, config);
    if (!leaf) return null;

    return summarize(leaf);
}

function walkSchema(schema: Schema, segments: string[], config: BuildConfig): Schema | null {
    let current: Schema | null = resolveCombinators(schema, config);
    for (const seg of segments) {
        if (!current) return null;
        // Numeric segment → descend into array items
        if (/^\d+$/.test(seg)) {
            const items = (current as { items?: unknown }).items;
            if (!items || typeof items !== "object") return null;
            current = resolveCombinators(items as Schema, config);
            continue;
        }
        // Property lookup on object
        const props = mergedProperties(current, config);
        const next = props[seg];
        if (!next || typeof next !== "object") return null;
        current = resolveCombinators(next as Schema, config);
    }
    return current;
}

function resolveCombinators(schema: Schema, config: BuildConfig, depth = 0): Schema {
    if (depth > 8) return schema;
    let s = followRef(schema, config);
    if (s === null) return schema;
    // allOf/oneOf/anyOf — take a shallow merge of the first layer for description lookup
    const all = (s as { allOf?: unknown }).allOf;
    if (Array.isArray(all) && all.length > 0) {
        const merged: Schema = { ...s };
        for (const sub of all) {
            const r = resolveCombinators(sub as Schema, config, depth + 1);
            Object.assign(merged, { ...r, ...merged });
            if (r.properties) {
                merged.properties = { ...(r.properties as Schema), ...(merged.properties as Schema ?? {}) };
            }
        }
        s = merged;
    }
    return s;
}

function followRef(schema: Schema, config: BuildConfig): Schema | null {
    const seen = new Set<string>();
    let cur: Schema | null = schema;
    while (cur && typeof (cur as { $ref?: unknown }).$ref === "string") {
        const ref = (cur as { $ref: string }).$ref;
        if (seen.has(ref)) return cur;
        seen.add(ref);
        cur = resolveRefPointer(ref, config);
    }
    return cur;
}

function resolveRefPointer(ref: string, config: BuildConfig): Schema | null {
    if (!ref.startsWith("#/")) return null;
    const pointer: Pointer = ref
        .slice(2)
        .split("/")
        .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let node: unknown = config as unknown;
    for (const p of pointer) {
        if (!node || typeof node !== "object") return null;
        node = (node as Record<string, unknown>)[p as string];
    }
    return (node && typeof node === "object") ? (node as Schema) : null;
}

function mergedProperties(schema: Schema, config: BuildConfig): Record<string, Schema> {
    const out: Record<string, Schema> = {};
    const props = (schema as { properties?: unknown }).properties;
    if (props && typeof props === "object") {
        for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
            if (v && typeof v === "object") out[k] = v as Schema;
        }
    }
    const all = (schema as { allOf?: unknown }).allOf;
    if (Array.isArray(all)) {
        for (const sub of all) {
            const r = resolveCombinators(sub as Schema, config);
            const subProps = (r as { properties?: unknown }).properties;
            if (subProps && typeof subProps === "object") {
                for (const [k, v] of Object.entries(subProps as Record<string, unknown>)) {
                    if (v && typeof v === "object" && !out[k]) out[k] = v as Schema;
                }
            }
        }
    }
    return out;
}

function summarize(schema: Schema): OpenApiMetadata {
    const out: OpenApiMetadata = {};
    const desc = (schema as { description?: unknown }).description;
    if (typeof desc === "string" && desc.trim()) out.description = desc.trim();

    const custom = (schema as { _description?: unknown })._description;
    if (custom && typeof custom === "object") {
        out.customDescription = custom as Record<string, unknown>;
    }

    const type = (schema as { type?: unknown }).type;
    if (typeof type === "string") out.type = type;

    const enums = (schema as { enum?: unknown }).enum;
    if (Array.isArray(enums)) {
        out.enumValues = enums.map((v) => String(v));
    }

    return out;
}
