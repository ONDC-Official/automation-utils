/**
 * Types for the optional PDF-context module.
 *
 * A PdfIndex is built once at the start of the polish pipeline (when
 * --context-pdf is supplied), then queried per LLM call to inject small
 * retrieval-selected excerpts. The index lives entirely in-memory after load;
 * the on-disk cache only avoids re-extracting unchanged PDFs.
 */

export type PdfChunk = {
    id: string;                 // `<hash>:<n>`
    source: string;             // basename of the source PDF
    section?: string;           // heading detected at the start of the chunk
    text: string;
    /** Lowercased alphanumeric tokens (length >= 2, stopwords stripped). */
    tokens: string[];
    /** Total token count — equals tokens.length. Cached for BM25 dl factor. */
    length: number;
};

export type PdfIndex = {
    chunks: PdfChunk[];
    /** term -> document frequency across chunks */
    df: Map<string, number>;
    /** average chunk length (in tokens) */
    avgdl: number;
    /** total chunks (== chunks.length) */
    totalDocs: number;
    /** PDF sources that contributed at least one chunk (for logging) */
    sources: string[];
};

export type RetrievedExcerpts = {
    excerpts: string[];
    sources: string[];
    /** Total characters of excerpt text returned (excluding header tags). */
    totalChars: number;
};
