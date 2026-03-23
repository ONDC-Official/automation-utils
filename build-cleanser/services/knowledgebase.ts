import { existsSync, readFileSync } from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KnowledgeBaseEntry {
    info: string;
    type?: string;
    owner?: string;
    required?: boolean;
    usage?: string;
    [key: string]: unknown;
}

type KnowledgeBase = Record<string, KnowledgeBaseEntry>;

/**
 * Callback used throughout the converter to resolve a missing `info` string.
 * Receives the attribute suffix  e.g. "search.context.location.country.code"
 * and returns the best matching `info` found across any domain/version, or
 * undefined when nothing is available.
 */
export type KbLookup = (attrSuffix: string) => string | undefined;

// ─── Suffix extraction ───────────────────────────────────────────────────────
//
// KB key format: "{domain}.{version}.{action}.{dotted.attr.path}"
//
// domain  — never contains dots  (e.g. "ONDC:FIS12")
// version — dot-separated digits (e.g. "2.3.0")
// suffix  — everything that follows: "{action}.{dotted.attr.path}"
//
// Strategy: split on ".", skip index 0 (domain), skip every following segment
// that is a pure number (version parts), remainder is the suffix.

function extractSuffix(key: string): string {
    const parts = key.split(".");
    let i = 1; // skip domain
    while (i < parts.length && /^\d+$/.test(parts[i])) {
        i++;
    }
    return parts.slice(i).join(".");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load knowledgebase.json (if it exists) and return a lookup function.
 *
 * The lookup ignores domain + version and searches across all known
 * domains/versions for a matching attribute path.  First-wins — the file is
 * sorted alphabetically so the result is deterministic.
 *
 * Returns a no-op function when the file does not exist.
 */
export function loadKnowledgeLookup(kbPath: string): KbLookup {
    if (!existsSync(kbPath)) {
        return () => undefined;
    }

    const raw = JSON.parse(readFileSync(kbPath, "utf-8")) as Record<
        string,
        unknown
    >;

    // Normalise: migrate any legacy plain-string values to entry objects
    const kb: KnowledgeBase = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [
            k,
            typeof v === "string" ? { info: v } : (v as KnowledgeBaseEntry),
        ]),
    );

    // Build suffix → info index; first-wins across domains
    const index = new Map<string, string>();
    for (const [key, entry] of Object.entries(kb)) {
        const suffix = extractSuffix(key);
        if (!index.has(suffix)) {
            index.set(suffix, entry.info);
        }
    }

    return (suffix: string) => index.get(suffix);
}
