import { tokenize } from "./tokenize.js";
import type { PdfIndex, RetrievedExcerpts } from "./types.js";

/** Default per-LLM-call PDF excerpt budget (characters). */
export const PDF_EXCERPT_BUDGET = 1500;

const BM25_K1 = 1.5;
const BM25_B = 0.75;
/** Hard cap on number of excerpts returned even if the budget allows more. */
const MAX_EXCERPTS = 4;

/**
 * BM25-score every chunk in the index against `query`, then pack the highest
 * scorers into a character budget. Returns formatted excerpts with a
 * `[source: <file> § <section>]` header so the LLM can attribute claims.
 *
 * Safe to call when the index is empty or undefined — returns no excerpts.
 */
export function retrieveExcerpts(
    index: PdfIndex | undefined,
    query: string,
    budgetChars: number = PDF_EXCERPT_BUDGET,
): RetrievedExcerpts {
    const empty: RetrievedExcerpts = { excerpts: [], sources: [], totalChars: 0 };
    if (!index || index.totalDocs === 0) return empty;
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return empty;

    // Unique query terms for IDF; preserve order for tie-breaking.
    const qSeen = new Set<string>();
    const qUnique: string[] = [];
    for (const t of qTokens) {
        if (qSeen.has(t)) continue;
        qSeen.add(t);
        qUnique.push(t);
    }

    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < index.chunks.length; i++) {
        const c = index.chunks[i]!;
        let score = 0;
        // Build per-chunk term-frequency map lazily; tokens array is small.
        const tf = countTerms(c.tokens);
        const dl = c.length;
        for (const term of qUnique) {
            const f = tf.get(term);
            if (!f) continue;
            const df = index.df.get(term) ?? 0;
            const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));
            const numer = f * (BM25_K1 + 1);
            const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / Math.max(1, index.avgdl)));
            score += idf * (numer / denom);
        }
        if (score > 0) scored.push({ idx: i, score });
    }
    if (scored.length === 0) return empty;
    scored.sort((a, b) => b.score - a.score);

    const excerpts: string[] = [];
    const sources = new Set<string>();
    let used = 0;
    for (const { idx } of scored) {
        if (excerpts.length >= MAX_EXCERPTS) break;
        const c = index.chunks[idx]!;
        const header = `[source: ${c.source}${c.section ? ` § ${c.section}` : ""}]`;
        const remaining = budgetChars - used;
        if (remaining <= header.length + 32) break;
        const bodyBudget = remaining - header.length - 2; // 2 for "\n"
        const body = c.text.length <= bodyBudget ? c.text : c.text.slice(0, bodyBudget - 1) + "…";
        const block = `${header}\n${body}`;
        excerpts.push(block);
        sources.add(c.source);
        used += block.length + 2; // 2 for inter-block "\n\n"
        if (used >= budgetChars) break;
    }
    return { excerpts, sources: [...sources], totalChars: used };
}

function countTerms(tokens: string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
}

/**
 * Format excerpts as a single labelled block for prompt injection. Returns
 * empty string when no excerpts — callers can concatenate unconditionally.
 */
export function formatExcerptBlock(retrieved: RetrievedExcerpts, label = "REFERENCE EXCERPTS"): string {
    if (retrieved.excerpts.length === 0) return "";
    return [
        `${label} (supplementary domain context from author-supplied PDFs; treat as background, never quote verbatim):`,
        ...retrieved.excerpts,
    ].join("\n\n");
}
