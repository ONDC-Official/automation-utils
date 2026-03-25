import type { BuildConfig, FlowEntry } from "../types/build-type.js";
import type { ChangeEntry, ChangeSection } from "./types.js";

export const MAX_ENTRIES_PER_SECTION = 100;

function makeSection(section: string, label: string, allEntries: ChangeEntry[]): ChangeSection {
    const truncated = allEntries.length > MAX_ENTRIES_PER_SECTION;
    return {
        section,
        label,
        totalChanges: allEntries.length,
        entries: truncated ? allEntries.slice(0, MAX_ENTRIES_PER_SECTION) : allEntries,
        truncated,
        truncatedCount: truncated ? allEntries.length - MAX_ENTRIES_PER_SECTION : 0,
    };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Stable JSON stringify for deep equality (handles key ordering) */
function stableStringify(val: unknown): string {
    if (val === null || val === undefined) return String(val);
    if (typeof val !== "object") return JSON.stringify(val);
    if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
    const sorted = Object.keys(val as Record<string, unknown>).sort();
    return `{${sorted.map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`).join(",")}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b);
}

/** Compact preview of a value for before/after display */
function preview(val: unknown, maxLen = 120): string {
    if (val === null || val === undefined) return "(empty)";
    const s = typeof val === "string" ? val : JSON.stringify(val);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

/**
 * Generic deep-diff between two arbitrary objects.
 * Produces flat ChangeEntry[] with dot-paths relative to `prefix`.
 * Recurses into plain objects; treats arrays/primitives as atomic.
 */
function deepDiffEntries(
    oldVal: unknown,
    newVal: unknown,
    prefix: string,
    summaryPrefix: string,
): ChangeEntry[] {
    const entries: ChangeEntry[] = [];

    if (deepEqual(oldVal, newVal)) return entries;

    const oldIsObj = oldVal !== null && typeof oldVal === "object" && !Array.isArray(oldVal);
    const newIsObj = newVal !== null && typeof newVal === "object" && !Array.isArray(newVal);

    if (oldIsObj && newIsObj) {
        const oldObj = oldVal as Record<string, unknown>;
        const newObj = newVal as Record<string, unknown>;
        const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

        for (const key of allKeys) {
            const childPath = prefix ? `${prefix}.${key}` : key;
            const childSummary = summaryPrefix ? `${summaryPrefix}.${key}` : key;

            if (!(key in oldObj)) {
                entries.push({
                    kind: "added",
                    path: childPath,
                    summary: `Added: ${childSummary}`,
                });
            } else if (!(key in newObj)) {
                entries.push({
                    kind: "removed",
                    path: childPath,
                    summary: `Removed: ${childSummary}`,
                });
            } else if (!deepEqual(oldObj[key], newObj[key])) {
                // For nested objects, recurse; for leaves/arrays, report atomic change
                const oChild = oldObj[key];
                const nChild = newObj[key];
                const oIsObj =
                    oChild !== null && typeof oChild === "object" && !Array.isArray(oChild);
                const nIsObj =
                    nChild !== null && typeof nChild === "object" && !Array.isArray(nChild);

                if (oIsObj && nIsObj) {
                    entries.push(...deepDiffEntries(oChild, nChild, childPath, childSummary));
                } else {
                    entries.push({
                        kind: "modified",
                        path: childPath,
                        summary: `Changed: ${childSummary}`,
                        before: preview(oChild),
                        after: preview(nChild),
                    });
                }
            }
        }
    } else {
        // Atomic change (different shapes, arrays, or primitives)
        entries.push({
            kind: "modified",
            path: prefix,
            summary: `Changed: ${summaryPrefix}`,
            before: preview(oldVal),
            after: preview(newVal),
        });
    }

    return entries;
}

// ─── Info ─────────────────────────────────────────────────────────────────────

export function diffInfo(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];

    // ① Scalar fields (now includes domain + version)
    const fields = [
        "title",
        "description",
        "domain",
        "version",
        "x-branch-name",
        "x-reporting",
    ] as const;

    for (const field of fields) {
        const o = String(oldC.info[field] ?? "");
        const n = String(newC.info[field] ?? "");
        if (o !== n) {
            entries.push({
                kind: "modified",
                path: `info.${field}`,
                summary: `${field} changed`,
                before: o,
                after: n,
            });
        }
    }

    // ② x-usecases (array diff)
    const oldUC = oldC.info["x-usecases"];
    const newUC = newC.info["x-usecases"];
    for (const uc of newUC.filter((u) => !oldUC.includes(u))) {
        entries.push({
            kind: "added",
            path: `info.x-usecases`,
            summary: `Use case added: "${uc}"`,
        });
    }
    for (const uc of oldUC.filter((u) => !newUC.includes(u))) {
        entries.push({
            kind: "removed",
            path: `info.x-usecases`,
            summary: `Use case removed: "${uc}"`,
        });
    }

    // ③ Root openapi version
    if (oldC.openapi !== newC.openapi) {
        entries.push({
            kind: "modified",
            path: "openapi",
            summary: "OpenAPI version changed",
            before: oldC.openapi,
            after: newC.openapi,
        });
    }

    return entries.length ? makeSection("info", "Spec Info", entries) : null;
}

// ─── Flows ────────────────────────────────────────────────────────────────────

export function diffFlows(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const oldMap = new Map<string, FlowEntry>(oldC["x-flows"].map((f) => [f.id, f]));
    const newMap = new Map<string, FlowEntry>(newC["x-flows"].map((f) => [f.id, f]));

    for (const [id, flow] of newMap) {
        const basePath = `x-flows.${id}`;
        if (!oldMap.has(id)) {
            entries.push({
                kind: "added",
                path: basePath,
                summary: `Flow added: "${id}" (${flow.usecase})`,
            });
            continue;
        }
        const old = oldMap.get(id)!;

        // Scalar fields
        if (old.description !== flow.description) {
            entries.push({
                kind: "modified",
                path: `${basePath}.description`,
                summary: `Flow "${id}" description changed`,
                before: old.description,
                after: flow.description,
            });
        }
        if (old.usecase !== flow.usecase) {
            entries.push({
                kind: "modified",
                path: `${basePath}.usecase`,
                summary: `Flow "${id}" usecase changed`,
                before: old.usecase,
                after: flow.usecase,
            });
        }

        // Tags
        const addedTags = flow.tags.filter((t) => !old.tags.includes(t));
        const removedTags = old.tags.filter((t) => !flow.tags.includes(t));
        for (const t of addedTags)
            entries.push({
                kind: "added",
                path: `${basePath}.tags`,
                summary: `Flow "${id}" tag added: "${t}"`,
            });
        for (const t of removedTags)
            entries.push({
                kind: "removed",
                path: `${basePath}.tags`,
                summary: `Flow "${id}" tag removed: "${t}"`,
            });

        // ★ NEW: Deep-diff the flow config object
        if (!deepEqual(old.config, flow.config)) {
            entries.push(
                ...deepDiffEntries(
                    old.config,
                    flow.config,
                    `${basePath}.config`,
                    `Flow "${id}" config`,
                ),
            );
        }
    }

    for (const id of oldMap.keys()) {
        if (!newMap.has(id)) {
            entries.push({
                kind: "removed",
                path: `x-flows.${id}`,
                summary: `Flow removed: "${id}"`,
            });
        }
    }

    return entries.length ? makeSection("flows", "Flows", entries) : null;
}

// ─── Attributes ───────────────────────────────────────────────────────────────

/**
 * Flatten attribute tree to leaf-level signatures.
 * Now captures ALL _description fields, not just required+type.
 */
function flattenAttributeLeafPaths(
    node: Record<string, unknown>,
    prefix: string,
    out: Map<string, string>,
): void {
    for (const [key, val] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;

        if (key === "_description" && val !== null && typeof val === "object") {
            // ★ ENHANCED: capture full leaf signature
            const leaf = val as Record<string, unknown>;
            const sig: Record<string, unknown> = {
                required: leaf["required"],
                type: leaf["type"],
                usage: leaf["usage"],
                info: leaf["info"],
                owner: leaf["owner"],
            };

            // Include enums/enumrefs/tags if present
            if (leaf["enums"]) sig["enums"] = leaf["enums"];
            if (leaf["enumrefs"]) sig["enumrefs"] = leaf["enumrefs"];
            if (leaf["tags"]) sig["tags"] = leaf["tags"];

            out.set(prefix, stableStringify(sig));
        } else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            flattenAttributeLeafPaths(val as Record<string, unknown>, path, out);
        }
    }
}

export function diffAttributes(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];

    const oldByUC = new Map(oldC["x-attributes"].map((a) => [a.meta?.use_case_id ?? "default", a]));
    const newByUC = new Map(newC["x-attributes"].map((a) => [a.meta?.use_case_id ?? "default", a]));

    for (const [ucId, newAttr] of newByUC) {
        if (!oldByUC.has(ucId)) {
            entries.push({
                kind: "added",
                path: `x-attributes.${ucId}`,
                summary: `Attribute use-case added: "${ucId}"`,
            });
            continue;
        }
        const oldAttr = oldByUC.get(ucId)!;

        // ★ NEW: diff meta changes
        if (!deepEqual(oldAttr.meta, newAttr.meta)) {
            entries.push({
                kind: "modified",
                path: `x-attributes.${ucId}.meta`,
                summary: `Attribute "${ucId}" meta changed`,
                before: preview(oldAttr.meta),
                after: preview(newAttr.meta),
            });
        }

        const oldPaths = new Map<string, string>();
        const newPaths = new Map<string, string>();

        for (const [action, node] of Object.entries(oldAttr.attribute_set ?? {})) {
            if (node) flattenAttributeLeafPaths(node as Record<string, unknown>, action, oldPaths);
        }
        for (const [action, node] of Object.entries(newAttr.attribute_set ?? {})) {
            if (node) flattenAttributeLeafPaths(node as Record<string, unknown>, action, newPaths);
        }

        for (const [path, newSig] of newPaths) {
            if (!oldPaths.has(path)) {
                entries.push({
                    kind: "added",
                    path: `x-attributes.${ucId}.${path}`,
                    summary: `Attribute added: ${path}`,
                });
            } else if (oldPaths.get(path) !== newSig) {
                entries.push({
                    kind: "modified",
                    path: `x-attributes.${ucId}.${path}`,
                    summary: `Attribute changed: ${path}`,
                    before: oldPaths.get(path),
                    after: newSig,
                });
            }
        }
        for (const path of oldPaths.keys()) {
            if (!newPaths.has(path)) {
                entries.push({
                    kind: "removed",
                    path: `x-attributes.${ucId}.${path}`,
                    summary: `Attribute removed: ${path}`,
                });
            }
        }
    }

    for (const ucId of oldByUC.keys()) {
        if (!newByUC.has(ucId)) {
            entries.push({
                kind: "removed",
                path: `x-attributes.${ucId}`,
                summary: `Attribute use-case removed: "${ucId}"`,
            });
        }
    }

    return entries.length ? makeSection("attributes", "Attributes", entries) : null;
}

// ─── Error Codes ──────────────────────────────────────────────────────────────

export function diffErrors(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const toKey = (e: { code: string | number }) => String(e.code);
    const oldMap = new Map(oldC["x-errors-codes"].code.map((e) => [toKey(e), e]));
    const newMap = new Map(newC["x-errors-codes"].code.map((e) => [toKey(e), e]));

    for (const [code, entry] of newMap) {
        if (!oldMap.has(code)) {
            entries.push({
                kind: "added",
                path: `x-errors-codes.${code}`,
                summary: `Error code added: ${code} — ${entry.Event}`,
            });
        } else {
            const old = oldMap.get(code)!;
            // ★ ENHANCED: report each changed field individually
            if (old.Event !== entry.Event) {
                entries.push({
                    kind: "modified",
                    path: `x-errors-codes.${code}.Event`,
                    summary: `Error code ${code}: Event changed`,
                    before: old.Event,
                    after: entry.Event,
                });
            }
            if (old.Description !== entry.Description) {
                entries.push({
                    kind: "modified",
                    path: `x-errors-codes.${code}.Description`,
                    summary: `Error code ${code}: Description changed`,
                    before: old.Description,
                    after: entry.Description,
                });
            }
            if (old.From !== entry.From) {
                entries.push({
                    kind: "modified",
                    path: `x-errors-codes.${code}.From`,
                    summary: `Error code ${code}: From changed`,
                    before: old.From,
                    after: entry.From,
                });
            }
        }
    }
    for (const code of oldMap.keys()) {
        if (!newMap.has(code)) {
            entries.push({
                kind: "removed",
                path: `x-errors-codes.${code}`,
                summary: `Error code removed: ${code}`,
            });
        }
    }

    return entries.length ? makeSection("errors", "Error Codes", entries) : null;
}

// ─── Supported Actions ────────────────────────────────────────────────────────

export function diffActions(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const oldSA = oldC["x-supported-actions"].supportedActions;
    const newSA = newC["x-supported-actions"].supportedActions;

    for (const action of Object.keys(newSA)) {
        if (!(action in oldSA)) {
            entries.push({
                kind: "added",
                path: `x-supported-actions.${action}`,
                summary: `Action added: ${action}`,
            });
        } else {
            const added = newSA[action].filter((a) => !oldSA[action].includes(a));
            const removed = oldSA[action].filter((a) => !newSA[action].includes(a));
            for (const a of added)
                entries.push({
                    kind: "added",
                    path: `x-supported-actions.${action}`,
                    summary: `Action "${action}": next action added "${a}"`,
                });
            for (const a of removed)
                entries.push({
                    kind: "removed",
                    path: `x-supported-actions.${action}`,
                    summary: `Action "${action}": next action removed "${a}"`,
                });
        }
    }
    for (const action of Object.keys(oldSA)) {
        if (!(action in newSA)) {
            entries.push({
                kind: "removed",
                path: `x-supported-actions.${action}`,
                summary: `Action removed: ${action}`,
            });
        }
    }

    // ★ NEW: diff apiProperties
    const oldAP = oldC["x-supported-actions"].apiProperties;
    const newAP = newC["x-supported-actions"].apiProperties;

    for (const action of Object.keys(newAP)) {
        const basePath = `x-supported-actions.apiProperties.${action}`;
        if (!(action in oldAP)) {
            entries.push({
                kind: "added",
                path: basePath,
                summary: `API property added: ${action}`,
            });
        } else {
            const oldProp = oldAP[action];
            const newProp = newAP[action];

            if (oldProp.async_predecessor !== newProp.async_predecessor) {
                entries.push({
                    kind: "modified",
                    path: `${basePath}.async_predecessor`,
                    summary: `"${action}" async_predecessor changed`,
                    before: oldProp.async_predecessor ?? "(null)",
                    after: newProp.async_predecessor ?? "(null)",
                });
            }

            const addedTP = newProp.transaction_partner.filter(
                (t) => !oldProp.transaction_partner.includes(t),
            );
            const removedTP = oldProp.transaction_partner.filter(
                (t) => !newProp.transaction_partner.includes(t),
            );
            for (const t of addedTP)
                entries.push({
                    kind: "added",
                    path: `${basePath}.transaction_partner`,
                    summary: `"${action}" transaction_partner added: "${t}"`,
                });
            for (const t of removedTP)
                entries.push({
                    kind: "removed",
                    path: `${basePath}.transaction_partner`,
                    summary: `"${action}" transaction_partner removed: "${t}"`,
                });
        }
    }
    for (const action of Object.keys(oldAP)) {
        if (!(action in newAP)) {
            entries.push({
                kind: "removed",
                path: `x-supported-actions.apiProperties.${action}`,
                summary: `API property removed: ${action}`,
            });
        }
    }

    return entries.length ? makeSection("actions", "Supported Actions", entries) : null;
}

// ─── API Paths ────────────────────────────────────────────────────────────────

export function diffPaths(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const oldPaths = Object.keys(oldC.paths ?? {});
    const newPaths = Object.keys(newC.paths ?? {});

    for (const p of newPaths.filter((x) => !oldPaths.includes(x))) {
        entries.push({ kind: "added", path: `paths.${p}`, summary: `Path added: ${p}` });
    }
    for (const p of oldPaths.filter((x) => !newPaths.includes(x))) {
        entries.push({ kind: "removed", path: `paths.${p}`, summary: `Path removed: ${p}` });
    }

    // Existing paths — diff methods and operation contents
    for (const p of newPaths.filter((x) => oldPaths.includes(x))) {
        const oldMethods = Object.keys(oldC.paths[p] ?? {});
        const newMethods = Object.keys(newC.paths[p] ?? {});

        for (const m of newMethods.filter((x) => !oldMethods.includes(x))) {
            entries.push({
                kind: "added",
                path: `paths.${p}.${m}`,
                summary: `Method added: ${m.toUpperCase()} ${p}`,
            });
        }
        for (const m of oldMethods.filter((x) => !newMethods.includes(x))) {
            entries.push({
                kind: "removed",
                path: `paths.${p}.${m}`,
                summary: `Method removed: ${m.toUpperCase()} ${p}`,
            });
        }

        // ★ NEW: deep-diff each shared operation
        for (const m of newMethods.filter((x) => oldMethods.includes(x))) {
            const oldOp = oldC.paths[p][m];
            const newOp = newC.paths[p][m];
            if (!deepEqual(oldOp, newOp)) {
                entries.push(
                    ...deepDiffEntries(oldOp, newOp, `paths.${p}.${m}`, `${m.toUpperCase()} ${p}`),
                );
            }
        }
    }

    return entries.length ? makeSection("paths", "API Paths", entries) : null;
}

// ─── Validations (NEW) ───────────────────────────────────────────────────────

export function diffValidations(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const oldVal = oldC["x-validations"];
    const newVal = newC["x-validations"];

    if (deepEqual(oldVal, newVal)) return null;

    const entries = deepDiffEntries(oldVal, newVal, "x-validations", "Validation");

    // If deepDiff returned nothing (e.g. both are opaque non-objects), still report a change
    if (entries.length === 0) {
        entries.push({
            kind: "modified",
            path: "x-validations",
            summary: "Validation rules changed",
            before: preview(oldVal),
            after: preview(newVal),
        });
    }

    return makeSection("validations", "Validations", entries);
}

// ─── Docs (NEW) ──────────────────────────────────────────────────────────────

export function diffDocs(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const oldDocs = oldC["x-docs"] ?? {};
    const newDocs = newC["x-docs"] ?? {};
    const entries: ChangeEntry[] = [];

    for (const key of Object.keys(newDocs)) {
        if (!(key in oldDocs)) {
            entries.push({
                kind: "added",
                path: `x-docs.${key}`,
                summary: `Doc added: "${key}"`,
            });
        } else if (oldDocs[key] !== newDocs[key]) {
            entries.push({
                kind: "modified",
                path: `x-docs.${key}`,
                summary: `Doc updated: "${key}"`,
                before: `${oldDocs[key].length} chars`,
                after: `${newDocs[key].length} chars`,
            });
        }
    }
    for (const key of Object.keys(oldDocs)) {
        if (!(key in newDocs)) {
            entries.push({
                kind: "removed",
                path: `x-docs.${key}`,
                summary: `Doc removed: "${key}"`,
            });
        }
    }

    return entries.length ? makeSection("docs", "Documentation", entries) : null;
}

// ─── Components (NEW) ────────────────────────────────────────────────────────

export function diffComponents(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    if (deepEqual(oldC.components, newC.components)) return null;

    const entries = deepDiffEntries(oldC.components, newC.components, "components", "Component");

    if (entries.length === 0) {
        entries.push({
            kind: "modified",
            path: "components",
            summary: "Components changed",
            before: preview(oldC.components),
            after: preview(newC.components),
        });
    }

    return makeSection("components", "Components", entries);
}

// ─── Security (NEW) ──────────────────────────────────────────────────────────

export function diffSecurity(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    if (deepEqual(oldC.security, newC.security)) return null;

    const entries = deepDiffEntries(oldC.security, newC.security, "security", "Security");

    if (entries.length === 0) {
        entries.push({
            kind: "modified",
            path: "security",
            summary: "Security config changed",
            before: preview(oldC.security),
            after: preview(newC.security),
        });
    }

    return makeSection("security", "Security", entries);
}
