import type { ReferenceHit } from "./types.js";

/**
 * Fuzzy scan for attribute-path references in JS source.
 *
 * Real code uses many shapes for the same logical path:
 *   payload.message.intent.category.descriptor.code
 *   payload?.message?.intent?.category?.descriptor?.code
 *   payload["message"]["intent"]["category"]["descriptor"]["code"]
 *   payload.message.tags[0].list[2].value     (array indices)
 *   const { message } = payload; message.intent.category...   (destructured root)
 *
 * Strategy: tokenize source into property-access chains, normalize each to
 * its segment array (dropping numeric indices), then check whether the target
 * gap-path is a suffix of the chain (also with indices dropped).
 *
 * This naturally handles: optional chaining, bracket notation, numeric
 * indices, and chains that start from a destructured variable instead of the
 * full root (since the tail still matches).
 */

// Match chains like `foo.bar?.baz["qux"][0].quux` starting at identifiers.
// Kept lenient — captures greedy segments; we further split per match.
const CHAIN_RE =
    /[A-Za-z_$][\w$]*(?:\s*(?:\?\.)?\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*\d+\s*\]|\[\s*"[^"]+"\s*\]|\[\s*'[^']+'\s*\]))+/g;

// Extract individual segments (identifiers, numeric indices, quoted strings) from a chain.
const SEG_RE = /[A-Za-z_$][\w$]*|\[\s*(\d+)\s*\]|\[\s*"([^"]+)"\s*\]|\[\s*'([^']+)'\s*\]/g;

export type PathSegments = string[]; // without action prefix; may contain numeric-string indices

function parseChain(chain: string): string[] {
    const segs: string[] = [];
    let m: RegExpExecArray | null;
    SEG_RE.lastIndex = 0;
    while ((m = SEG_RE.exec(chain)) !== null) {
        if (m[2] !== undefined) segs.push(m[2]);        // bracket "x"
        else if (m[3] !== undefined) segs.push(m[3]);   // bracket 'x'
        else if (m[1] !== undefined) segs.push(m[1]);   // bracket 0 (numeric)
        else segs.push(m[0]);                           // identifier
    }
    return segs;
}

function normalize(segs: string[]): string[] {
    return segs.filter((s) => !/^\d+$/.test(s));
}

/** transaction_id → transactionId; preserves identifiers without underscores. */
function snakeToCamel(s: string): string {
    if (!s.includes("_")) return s;
    return s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** transactionId → transaction_id. */
function camelToSnake(s: string): string {
    return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Returns up to two case variants of segs (snake-cased and camelCased). */
function caseVariants(segs: string[]): string[][] {
    const snake = segs.map(camelToSnake);
    const camel = segs.map(snakeToCamel);
    const out: string[][] = [segs];
    if (!arrayEq(snake, segs)) out.push(snake);
    if (!arrayEq(camel, segs) && !out.some((v) => arrayEq(v, camel))) out.push(camel);
    return out;
}

function arrayEq(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function isSuffix(needle: string[], haystack: string[]): boolean {
    if (needle.length === 0 || needle.length > haystack.length) return false;
    const start = haystack.length - needle.length;
    for (let i = 0; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) return false;
    }
    return true;
}

/**
 * Does `chain` (already parsed to segments) match the gap path?
 * Matches if any pre-computed variant is a suffix of the chain.
 */
function chainMatchesVariants(chain: string[], variants: string[][]): boolean {
    const nc = normalize(chain);
    for (const variant of variants) {
        if (isSuffix(variant, nc)) return true;
        if (variant.length >= 3 && isSuffix(variant.slice(-3), nc)) return true;
    }
    return false;
}

function captureSnippet(src: string, index: number, ctxLines = 2): string {
    const before = src.lastIndexOf("\n", Math.max(0, index - 1));
    let end = index;
    for (let i = 0; i < ctxLines + 1; i++) {
        const next = src.indexOf("\n", end + 1);
        if (next < 0) {
            end = src.length;
            break;
        }
        end = next;
    }
    let start = before;
    for (let i = 0; i < ctxLines; i++) {
        const prev = src.lastIndexOf("\n", Math.max(0, start - 1));
        if (prev < 0) {
            start = 0;
            break;
        }
        start = prev;
    }
    return src.slice(Math.max(0, start), end).trim();
}

/**
 * Scan one block of JS for references to the gap path.
 * gapSegs is the path without the action prefix (e.g. ["message","intent","category","id"]).
 * Detects:
 *   - property-access chains (foo.bar.baz, foo?.bar, foo["bar"], etc.)
 *   - quoted dotted strings ("a.b.c", '$.a.b.c') in code (e.g. _.get / getValue / JSONPath)
 *   - comments (// or /* ... *​/) that mention the path
 * Snake/camel variants of the gap path are matched.
 */
export function scanSource(
    src: string,
    gapSegs: string[],
    meta: { flowId: string; actionId: string; kind: "generate" | "validate" | "requirements" },
    maxHits = 4,
): ReferenceHit[] {
    if (!src || gapSegs.length === 0) return [];
    const ng = normalize(gapSegs);
    const variants = caseVariants(ng);
    const hits: ReferenceHit[] = [];

    // Cheap pre-filter: if the source doesn't contain any segment of the gap,
    // skip all regex work. Avoids catastrophic per-attribute cost on large blobs.
    let presence = false;
    for (const v of variants) {
        for (const seg of v) {
            if (seg.length >= 3 && src.includes(seg)) {
                presence = true;
                break;
            }
        }
        if (presence) break;
    }
    if (!presence) return [];

    // 1) chain matches in code
    let m: RegExpExecArray | null;
    CHAIN_RE.lastIndex = 0;
    while ((m = CHAIN_RE.exec(src)) !== null) {
        if (hits.length >= maxHits) break;
        const chain = parseChain(m[0]);
        if (!chainMatchesVariants(chain, variants)) continue;
        hits.push({
            flowId: meta.flowId,
            actionId: meta.actionId,
            kind: meta.kind,
            snippet: captureSnippet(src, m.index),
            matchedChain: m[0],
        });
    }

    // 2) quoted JSONPath / dotted strings
    if (hits.length < maxHits) {
        for (const q of scanQuotedPaths(src, variants)) {
            if (hits.length >= maxHits) break;
            hits.push({
                flowId: meta.flowId,
                actionId: meta.actionId,
                kind: meta.kind,
                snippet: captureSnippet(src, q.index),
                matchedChain: q.matched,
            });
        }
    }

    // 3) comments mentioning the path
    if (hits.length < maxHits) {
        for (const c of scanComments(src, variants)) {
            if (hits.length >= maxHits) break;
            hits.push({
                flowId: meta.flowId,
                actionId: meta.actionId,
                kind: "comment",
                snippet: c.text,
                matchedChain: c.matched,
            });
        }
    }

    return hits;
}

// Non-backtracking: a quoted run of identifier/dot/bracket chars only.
// Catches "a.b.c", '$.a.b.c', '$.foo[0].bar', "context.transaction_id".
const QUOTED_PATH_RE = /["']([$\w][\w$.\[\]]{2,200})["']/g;

function scanQuotedPaths(
    src: string,
    variants: string[][],
): Array<{ index: number; matched: string }> {
    const out: Array<{ index: number; matched: string }> = [];
    let m: RegExpExecArray | null;
    QUOTED_PATH_RE.lastIndex = 0;
    while ((m = QUOTED_PATH_RE.exec(src)) !== null) {
        const inner = m[1] ?? "";
        if (!inner.includes(".")) continue;
        const segs = inner
            .split(/\.|\[[^\]]*\]/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (segs.length < 2) continue;
        if (!chainMatchesVariants(segs, variants)) continue;
        out.push({ index: m.index, matched: m[0] });
    }
    return out;
}

const LINE_COMMENT_RE = /\/\/[^\n]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

function scanComments(
    src: string,
    variants: string[][],
): Array<{ text: string; matched: string }> {
    const out: Array<{ text: string; matched: string }> = [];
    if (variants.length === 0) return out;

    const consider = (text: string): void => {
        for (const v of variants) {
            // Match the path either as a dotted string or as the joined identifier.
            const dotted = v.join(".");
            if (text.includes(dotted)) {
                out.push({ text: text.trim(), matched: dotted });
                return;
            }
            // Also accept when last 2-3 segments appear as adjacent words.
            if (v.length >= 2) {
                const tail = v.slice(-2).join(".");
                if (text.includes(tail)) {
                    out.push({ text: text.trim(), matched: tail });
                    return;
                }
            }
        }
    };

    LINE_COMMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINE_COMMENT_RE.exec(src)) !== null) consider(m[0]);
    BLOCK_COMMENT_RE.lastIndex = 0;
    while ((m = BLOCK_COMMENT_RE.exec(src)) !== null) consider(m[0]);
    return out;
}

/**
 * Scan only the comments of a JS blob for path mentions. Returns full
 * ReferenceHits with kind="comment". Used as a complement to AST-based
 * scanning, which drops comments by default.
 */
export function scanCommentsOnly(
    src: string,
    gapSegs: string[],
    meta: { flowId: string; actionId: string },
    maxHits = 2,
): ReferenceHit[] {
    if (!src || gapSegs.length === 0) return [];
    const ng = normalize(gapSegs);
    const variants = caseVariants(ng);
    const out: ReferenceHit[] = [];
    for (const c of scanComments(src, variants)) {
        if (out.length >= maxHits) break;
        out.push({
            flowId: meta.flowId,
            actionId: meta.actionId,
            kind: "comment",
            snippet: c.text,
            matchedChain: c.matched,
        });
    }
    return out;
}

/**
 * Scan source for occurrences of a single identifier (used for saveData
 * alias lookups: when generate persists `transactionId` to session and another
 * step's code reads it as `transactionId`).
 */
export function scanIdentifier(
    src: string,
    ident: string,
    meta: { flowId: string; actionId: string },
    maxHits = 2,
): ReferenceHit[] {
    if (!src || !ident) return [];
    const re = new RegExp(`\\b${escapeRegex(ident)}\\b`, "g");
    const out: ReferenceHit[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        if (out.length >= maxHits) break;
        out.push({
            flowId: meta.flowId,
            actionId: meta.actionId,
            kind: "alias",
            snippet: captureSnippet(src, m.index),
            matchedChain: ident,
        });
    }
    return out;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan a saveData record (object of {key: "$.a.b.c"}) for JSONPaths that end at
 * the gap path (or whose tail matches the gap's tail).
 */
export function scanSaveData(
    saveData: Record<string, unknown> | undefined,
    gapSegs: string[],
): Array<{ key: string; jsonpath: string }> {
    if (!saveData || gapSegs.length === 0) return [];
    const ng = normalize(gapSegs);
    const variants = caseVariants(ng);
    const hits: Array<{ key: string; jsonpath: string }> = [];
    for (const [key, raw] of Object.entries(saveData)) {
        if (typeof raw !== "string") continue;
        const jp = raw.trim();
        // Strip leading $ and split on . — drop bracket indices too
        const segs = jp
            .replace(/^\$\.?/, "")
            .split(".")
            .flatMap((p) => p.split(/\[[^\]]*\]/))
            .map((s) => s.trim())
            .filter(Boolean);
        const nsegs = normalize(segs);
        if (nsegs.length === 0) continue;
        let matched = false;
        for (const v of variants) {
            if (isSuffix(v, nsegs)) {
                matched = true;
                break;
            }
            if (v.length >= 3 && isSuffix(v.slice(-3), nsegs)) {
                matched = true;
                break;
            }
        }
        if (matched) hits.push({ key, jsonpath: jp });
    }
    return hits;
}
