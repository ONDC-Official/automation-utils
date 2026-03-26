/**
 * Validation-table ingestion — stores a raw validation table into MongoDB.
 *
 * Each document is identified by `(domain, version)` and contains the full
 * raw_table.json structure. There are no changelogs — every call replaces the
 * existing document for that build.
 *
 * Usage:
 * ```ts
 * import { ingestValidationTable } from "@ondc/build-tools/store";
 *
 * await ingestValidationTable(db, {
 *   domain: "ONDC:RET10",
 *   version: "2.0.0",
 *   table: rawTableJson,
 * });
 * ```
 */

import type { Db } from "mongodb";

import type { StoredValidationTable, ValidationTableAction } from "./schemas.js";
import { VALIDATION_TABLE_COLLECTION } from "./collections.js";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface IngestValidationTableInput {
    domain: string;
    version: string;
    /** The raw_table.json content — a map from action name → action table. */
    table: Record<string, ValidationTableAction>;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface IngestValidationTableResult {
    domain: string;
    version: string;
    /** Number of actions stored in the table. */
    actionCount: number;
}

// ─── Ingest ───────────────────────────────────────────────────────────────────

/**
 * Upserts a validation table document into `build_validation_table`.
 * Identified by `(domain, version)` — always replaces any existing document.
 *
 * @param db    - A connected MongoDB `Db` instance. The caller owns the connection.
 * @param input - The domain, version, and raw table to store.
 * @returns     Summary of what was ingested.
 */
export async function ingestValidationTable(
    db: Db,
    input: IngestValidationTableInput,
): Promise<IngestValidationTableResult> {
    const { domain, version, table } = input;
    const filter = { domain, version };

    const doc: StoredValidationTable = {
        domain,
        version,
        table,
        ingestedAt: new Date(),
    };

    await db
        .collection<StoredValidationTable>(VALIDATION_TABLE_COLLECTION)
        .replaceOne(filter, doc, { upsert: true });

    return {
        domain,
        version,
        actionCount: Object.keys(table).length,
    };
}
