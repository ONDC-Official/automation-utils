/**
 * Shared tokenizer for both indexing and query-side scoring. Splits on
 * non-alphanumeric, lowercases, drops short tokens and a tiny English
 * stopword set. snake_case and camelCase identifiers (common in attribute
 * paths) are also broken into their component words so a query like
 * `transaction_id` matches `transaction` and `id` separately.
 */

const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "with",
    "is",
    "are",
    "be",
    "this",
    "that",
    "it",
    "as",
    "by",
    "at",
    "from",
    "but",
    "not",
    "no",
    "if",
    "then",
    "than",
    "so",
    "do",
    "does",
    "did",
    "was",
    "were",
    "will",
    "shall",
    "can",
    "may",
    "has",
    "have",
    "had",
    "into",
    "out",
    "up",
    "down",
    "via",
    "per",
]);

export function tokenize(s: string): string[] {
    if (!s) return [];
    const out: string[] = [];
    // Split on non-alphanumeric boundaries first.
    const parts = s.split(/[^A-Za-z0-9]+/);
    for (const part of parts) {
        if (!part) continue;
        // camelCase / PascalCase split: HTTPServerError -> [HTTP, Server, Error]
        const sub = part.split(/(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/);
        for (const piece of sub) {
            const tok = piece.toLowerCase();
            if (tok.length < 2) continue;
            if (STOPWORDS.has(tok)) continue;
            out.push(tok);
        }
        // Keep the joined lowercase form too, so exact matches on
        // identifiers like "transaction_id" → "transactionid" still hit.
        const flat = part.toLowerCase();
        if (flat.length >= 2 && !STOPWORDS.has(flat) && flat !== sub[0]?.toLowerCase()) {
            out.push(flat);
        }
    }
    return out;
}
