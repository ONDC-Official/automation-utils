import { createHash } from "crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "fs";
import { basename, isAbsolute, join, resolve } from "path";
// pdf-parse v1.1.1's index.js executes a debug branch when invoked as the main
// module; the lib entry is the safe, side-effect-free import target.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { tokenize } from "./tokenize.js";
import type { PdfChunk, PdfIndex } from "./types.js";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 200;
const HEADING_RE = /^\s*(?:#{1,6}\s+.+|[A-Z][A-Z0-9 \-_/]{3,}|\d+(?:\.\d+){0,3}\s+\S.*)$/;

export type LoadResult = {
    index: PdfIndex;
    stats: { cached: number; extracted: number; chunks: number };
};

/**
 * Extract → chunk → BM25-index a set of PDF paths. Cached on disk by content
 * hash so re-runs skip re-extraction. Returns an empty-but-valid index when
 * `paths` is empty.
 */
export async function loadPdfs(paths: string[], cacheDir: string): Promise<LoadResult> {
    mkdirSync(cacheDir, { recursive: true });
    const allChunks: PdfChunk[] = [];
    const sources = new Set<string>();
    let cached = 0;
    let extracted = 0;

    for (const raw of paths) {
        const abs = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
        if (!existsSync(abs)) throw new Error(`context PDF not found: ${abs}`);
        const buf = readFileSync(abs);
        const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
        const dir = join(cacheDir, hash);
        const chunksFile = join(dir, "chunks.json");
        const source = basename(abs);
        sources.add(source);

        let chunks: PdfChunk[];
        if (existsSync(chunksFile)) {
            chunks = JSON.parse(readFileSync(chunksFile, "utf-8")) as PdfChunk[];
            cached++;
        } else {
            mkdirSync(dir, { recursive: true });
            const parsed = await pdfParse(buf);
            const text = normalizeText(parsed.text ?? "");
            writeFileSync(join(dir, "text.txt"), text, "utf-8");
            writeFileSync(
                join(dir, "meta.json"),
                JSON.stringify(
                    { source, abs, bytes: buf.byteLength, mtime: statSync(abs).mtimeMs },
                    null,
                    2,
                ),
                "utf-8",
            );
            chunks = chunkText(text, source, hash);
            writeFileSync(chunksFile, JSON.stringify(chunks), "utf-8");
            extracted++;
        }
        allChunks.push(...chunks);
    }

    const index = buildIndex(allChunks, [...sources]);
    return {
        index,
        stats: { cached, extracted, chunks: allChunks.length },
    };
}

function normalizeText(s: string): string {
    return s
        .replace(/\r\n?/g, "\n")
        .replace(/­/g, "") // soft hyphen
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Section-aware sliding-window chunker. Splits text on blank-line paragraphs,
 * tags each paragraph with the most recent heading line, then packs into
 * ~CHUNK_SIZE-char chunks with CHUNK_OVERLAP. Headings stay attached so
 * retrieved excerpts carry their context.
 */
export function chunkText(text: string, source: string, hash: string): PdfChunk[] {
    if (!text) return [];
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks: PdfChunk[] = [];
    let buf = "";
    let bufSection: string | undefined;
    let currentSection: string | undefined;
    let n = 0;

    const flush = (): void => {
        if (!buf.trim()) return;
        const tokens = tokenize(buf);
        if (tokens.length === 0) return;
        const chunk: PdfChunk = {
            id: `${hash}:${n++}`,
            source,
            text: buf.trim(),
            tokens,
            length: tokens.length,
        };
        if (bufSection) chunk.section = bufSection;
        chunks.push(chunk);
        // Carry overlap into the next chunk.
        if (buf.length > CHUNK_OVERLAP) {
            buf = buf.slice(buf.length - CHUNK_OVERLAP);
        } else {
            buf = "";
        }
        bufSection = currentSection;
    };

    for (const para of paragraphs) {
        if (isHeading(para)) {
            // A heading ends the previous chunk and seeds the next under the
            // new section. We must overwrite bufSection (flush() resets it to
            // the *old* currentSection); otherwise the next chunk inherits
            // the stale heading.
            flush();
            currentSection = para.replace(/^#+\s*/, "").trim().slice(0, 120);
            bufSection = currentSection;
            continue;
        }
        if (!bufSection) bufSection = currentSection;
        const candidate = buf ? `${buf}\n\n${para}` : para;
        if (candidate.length > CHUNK_SIZE && buf) {
            flush();
            buf = buf ? `${buf}\n\n${para}` : para;
        } else {
            buf = candidate;
        }
    }
    flush();
    return chunks;
}

function isHeading(line: string): boolean {
    if (line.length > 140) return false;
    if (!HEADING_RE.test(line)) return false;
    // Reject sentence-like lines ending with terminal punctuation.
    return !/[.!?]$/.test(line.trim());
}

function buildIndex(chunks: PdfChunk[], sources: string[]): PdfIndex {
    const df = new Map<string, number>();
    let totalLen = 0;
    for (const c of chunks) {
        totalLen += c.length;
        const seen = new Set<string>();
        for (const t of c.tokens) {
            if (seen.has(t)) continue;
            seen.add(t);
            df.set(t, (df.get(t) ?? 0) + 1);
        }
    }
    return {
        chunks,
        df,
        avgdl: chunks.length ? totalLen / chunks.length : 0,
        totalDocs: chunks.length,
        sources,
    };
}

export function emptyIndex(): PdfIndex {
    return { chunks: [], df: new Map(), avgdl: 0, totalDocs: 0, sources: [] };
}
