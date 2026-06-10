import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";
import type { ReviewFile } from "./types.js";

/**
 * Reuse of previously reviewed attribute descriptions from external `.polish`
 * folders (prior polish runs on OTHER usecases/domains).
 *
 * Matching is by `(action, pathKey)` and intentionally IGNORES usecase — the
 * external folder is from a different usecase, so the same `(action, path)` may
 * hit MULTIPLE external entries (e.g. GOLD_LOAN__confirm and PERSONAL_LOAN__confirm
 * both define `context.transaction_id`). Those become the list of matches.
 *
 * No dependency on draft.ts (keeps the dependency arrow draft.ts → reuse.ts clean);
 * fallback / sentinel literals are duplicated here intentionally.
 */

/** Cap on matches kept per `(action, path)` key for prompt injection. */
export const MAX_REUSE_MATCHES = 3;

const FALLBACK_PREFIX = "AUTO-FALLBACK";
const NO_DATA_SENTINEL = "<no-enough-data>";

export type ReuseMatch = {
    /** draft.info — guaranteed non-empty, non-fallback, non-sentinel. */
    info: string;
    /** Source usecase (for telemetry / distinctness). */
    usecase: string;
    action: string;
    /** Dotted pathKey, e.g. "context.transaction_id". */
    path: string;
    /** Absolute path of the review file the match came from (for logging). */
    sourceFile: string;
};

export type ReuseIndex = {
    /** key = `${action}::${pathKey}` → distinct matches (capped). */
    byKey: Map<string, ReuseMatch[]>;
    stats: { files: number; entries: number; kept: number; keys: number };
};

export function reuseKey(action: string, pathKey: string): string {
    return `${action}::${pathKey}`;
}

/**
 * Resolve a --reuse-from input to its `attributes-review` directory.
 * Accepts: the review dir itself, a `.polish` folder, or a polished output dir.
 * Returns null when none of those resolve.
 */
export function resolveReviewDir(inputPath: string): string | null {
    if (basename(inputPath) === "attributes-review" && isDir(inputPath)) {
        return inputPath;
    }
    const viaPolish = join(inputPath, ".polish", "attributes-review");
    if (isDir(viaPolish)) return viaPolish;
    const direct = join(inputPath, "attributes-review");
    if (isDir(direct)) return direct;
    return null;
}

function isDir(p: string): boolean {
    try {
        return existsSync(p) && statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function usableInfo(info: unknown): info is string {
    if (typeof info !== "string") return false;
    const t = info.trim();
    return t.length > 0 && !t.startsWith(FALLBACK_PREFIX) && t !== NO_DATA_SENTINEL;
}

/**
 * Load + index all APPROVED, non-fallback reviewed descriptions across the
 * supplied --reuse-from paths. Never throws: unresolvable paths and malformed
 * files become warnings.
 */
export function loadReuseIndex(paths: string[]): { index: ReuseIndex; warnings: string[] } {
    const byKey = new Map<string, ReuseMatch[]>();
    const warnings: string[] = [];
    let files = 0;
    let entries = 0;
    let kept = 0;

    for (const p of paths) {
        const dir = resolveReviewDir(p);
        if (!dir) {
            warnings.push(`no attributes-review dir found under "${p}" — skipping`);
            continue;
        }
        let names: string[];
        try {
            names = readdirSync(dir)
                .filter((n) => n.endsWith(".json"))
                .sort(); // alphabetical → deterministic "first match"
        } catch (err) {
            warnings.push(`cannot read "${dir}": ${msg(err)} — skipping`);
            continue;
        }

        for (const name of names) {
            const filePath = join(dir, name);
            let parsed: ReviewFile;
            try {
                parsed = JSON.parse(readFileSync(filePath, "utf-8")) as ReviewFile;
            } catch (err) {
                warnings.push(`malformed JSON "${filePath}": ${msg(err)} — skipping`);
                continue;
            }
            if (!parsed || !Array.isArray(parsed.attributes) || !parsed.action) {
                warnings.push(`unexpected shape "${filePath}" — skipping`);
                continue;
            }
            files++;
            const action = parsed.action;
            const usecase = parsed.usecase ?? "";
            for (const e of parsed.attributes) {
                entries++;
                if (!e || e.approved !== true) continue;
                if (!usableInfo(e.draft?.info)) continue;
                const key = reuseKey(action, e.path);
                const list = byKey.get(key) ?? [];
                if (addDistinct(list, { info: e.draft.info.trim(), usecase, action, path: e.path, sourceFile: filePath })) {
                    kept++;
                }
                byKey.set(key, list);
            }
        }
    }

    return { index: { byKey, stats: { files, entries, kept, keys: byKey.size } }, warnings };
}

/**
 * Append a match to a per-key list if distinct (by trimmed info AND by usecase)
 * and the cap is not yet reached. Returns true when actually added.
 */
function addDistinct(list: ReuseMatch[], m: ReuseMatch): boolean {
    if (list.length >= MAX_REUSE_MATCHES) return false;
    for (const x of list) {
        if (x.info === m.info) return false;
        if (x.usecase === m.usecase && m.usecase !== "") return false;
    }
    list.push(m);
    return true;
}

/** Matches for a dedup group's representative `(action, pathKey)`. */
export function lookupReuse(
    index: ReuseIndex | undefined,
    action: string,
    pathKey: string,
): ReuseMatch[] {
    if (!index) return [];
    return index.byKey.get(reuseKey(action, pathKey)) ?? [];
}

function msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
