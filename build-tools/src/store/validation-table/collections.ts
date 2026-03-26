/**
 * MongoDB collection name and index definition for the validation table.
 *
 * Call `createValidationTableIndexes(db)` once during application startup.
 * The function is idempotent — MongoDB silently skips indexes that already exist.
 */

import type { Db } from "mongodb";

// ─── Collection name ──────────────────────────────────────────────────────────

export const VALIDATION_TABLE_COLLECTION = "build_validation_table" as const;

export type ValidationTableCollectionName = typeof VALIDATION_TABLE_COLLECTION;

// ─── Index creation ───────────────────────────────────────────────────────────

/**
 * Creates the required index on `build_validation_table`.
 * The unique compound index on `domain + version` ensures at most one
 * validation table document exists per build.
 */
export async function createValidationTableIndexes(db: Db): Promise<void> {
    await db.collection(VALIDATION_TABLE_COLLECTION).createIndex(
        { domain: 1, version: 1 },
        { unique: true, name: "uq_domain_version" },
    );
}
