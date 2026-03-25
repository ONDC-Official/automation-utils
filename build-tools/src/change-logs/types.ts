/**
 * Storage recommendation: JSON (gzipped) on S3.
 *
 * Rationale:
 *  - Structured: frontend can filter/group by section, severity, or action
 *    without parsing a text document.
 *  - Compact: JSON + gzip shrinks by ~85% vs raw text (changelogs are repetitive).
 *  - Zero-dependency on frontend: JSON.parse(), no YAML/Markdown lib needed.
 *  - S3 key pattern: changelogs/<domain>/<oldVersion>-to-<newVersion>.json
 *    → sortable, range-queryable by prefix.
 *
 * Suggested S3 Content-Type: application/json
 * Suggested S3 Content-Encoding: gzip  (upload pre-compressed with zlib.gzipSync)
 */

export type ChangeKind = "added" | "removed" | "modified";

/** A single atomic change within a section */
export type ChangeEntry = {
    kind: ChangeKind;
    /** Dot-path to the changed item, e.g. "search.message.intent.provider.id" */
    path: string;
    summary: string;
    /** Present when kind === "modified" */
    before?: string;
    after?: string;
};

/** One logical section of the config (flows, attributes, errors, etc.) */
export type ChangeSection = {
    section: string;
    label: string;
    totalChanges: number;
    /**
     * Capped at MAX_ENTRIES_PER_SECTION.
     * If truncated, `truncated` will be true and `truncatedCount` will say how many were omitted.
     */
    entries: ChangeEntry[];
    truncated: boolean;
    truncatedCount: number;
};

/** Top-level changelog document — this is what gets written to S3 */
export type ChangeLog = {
    /** Schema version for the changelog format itself — bump when shape changes */
    schemaVersion: 1;
    generatedAt: string; // ISO 8601
    old: { domain: string; version: string; branch?: string };
    new: { domain: string; version: string; branch?: string };
    summary: {
        totalChanges: number;
        sections: { section: string; label: string; count: number }[];
    };
    sections: ChangeSection[];
};
