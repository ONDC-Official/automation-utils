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

// ─── Info ─────────────────────────────────────────────────────────────────────

export function diffInfo(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const fields = ["title", "description", "x-branch-name", "x-reporting"] as const;

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

    return entries.length ? makeSection("info", "Spec Info", entries) : null;
}

// ─── Flows ────────────────────────────────────────────────────────────────────

export function diffFlows(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const oldMap = new Map<string, FlowEntry>(oldC["x-flows"].map((f) => [f.id, f]));
    const newMap = new Map<string, FlowEntry>(newC["x-flows"].map((f) => [f.id, f]));

    for (const [id, flow] of newMap) {
        if (!oldMap.has(id)) {
            entries.push({
                kind: "added",
                path: `x-flows.${id}`,
                summary: `Flow added: "${id}" (${flow.usecase})`,
            });
            continue;
        }
        const old = oldMap.get(id)!;
        if (old.description !== flow.description) {
            entries.push({
                kind: "modified",
                path: `x-flows.${id}.description`,
                summary: `Flow "${id}" description changed`,
                before: old.description,
                after: flow.description,
            });
        }
        if (old.usecase !== flow.usecase) {
            entries.push({
                kind: "modified",
                path: `x-flows.${id}.usecase`,
                summary: `Flow "${id}" usecase changed`,
                before: old.usecase,
                after: flow.usecase,
            });
        }
        const addedTags = flow.tags.filter((t) => !old.tags.includes(t));
        const removedTags = old.tags.filter((t) => !flow.tags.includes(t));
        for (const t of addedTags)
            entries.push({
                kind: "added",
                path: `x-flows.${id}.tags`,
                summary: `Flow "${id}" tag added: "${t}"`,
            });
        for (const t of removedTags)
            entries.push({
                kind: "removed",
                path: `x-flows.${id}.tags`,
                summary: `Flow "${id}" tag removed: "${t}"`,
            });
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

function flattenAttributeLeafPaths(
    node: Record<string, unknown>,
    prefix: string,
    out: Map<string, string>,
): void {
    for (const [key, val] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (key === "_description" && val !== null && typeof val === "object") {
            // Stable summary: required + type
            const leaf = val as Record<string, unknown>;
            out.set(prefix, `required=${leaf["required"]}, type=${leaf["type"]}`);
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
            if (
                old.Description !== entry.Description ||
                old.Event !== entry.Event ||
                old.From !== entry.From
            ) {
                entries.push({
                    kind: "modified",
                    path: `x-errors-codes.${code}`,
                    summary: `Error code ${code} changed`,
                    before: `${old.Event} | ${old.From}`,
                    after: `${entry.Event} | ${entry.From}`,
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

    return entries.length ? makeSection("actions", "Supported Actions", entries) : null;
}

// ─── API Paths ────────────────────────────────────────────────────────────────

export function diffPaths(oldC: BuildConfig, newC: BuildConfig): ChangeSection | null {
    const entries: ChangeEntry[] = [];
    const oldPaths = Object.keys(oldC.paths);
    const newPaths = Object.keys(newC.paths);

    for (const p of newPaths.filter((x) => !oldPaths.includes(x))) {
        entries.push({ kind: "added", path: `paths.${p}`, summary: `Path added: ${p}` });
    }
    for (const p of oldPaths.filter((x) => !newPaths.includes(x))) {
        entries.push({ kind: "removed", path: `paths.${p}`, summary: `Path removed: ${p}` });
    }
    // For existing paths, detect added/removed methods
    for (const p of newPaths.filter((x) => oldPaths.includes(x))) {
        const oldMethods = Object.keys(oldC.paths[p]);
        const newMethods = Object.keys(newC.paths[p]);
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
    }

    return entries.length ? makeSection("paths", "API Paths", entries) : null;
}
