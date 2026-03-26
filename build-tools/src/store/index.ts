/**
 * Store module — MongoDB ingestion for ONDC build configs.
 *
 * Re-exports all public types, constants, and functions so consumers can
 * import from a single path:
 *
 * ```ts
 * import { ingestBuild, createIndexes, COLLECTIONS } from "@ondc/build-tools/store";
 * ```
 */

// Document types
export type {
    DomainVersion,
    StoredBuildMeta,
    StoredBuildDoc,
    StoredBuildFlow,
    StoredBuildAttribute,
    StoredBuildValidation,
    StoredChangeLog,
} from "./build-data/schemas.js";

// Collection names + index setup
export { COLLECTIONS, createIndexes } from "./build-data/collections.js";
export type { CollectionName } from "./build-data/collections.js";

// Changelog diffing
export { diffChangelog } from "./build-data/changelog.js";

// Build ingestion (main entry point)
export { ingestBuild } from "./build-data/ingest.js";
export type { IngestResult } from "./build-data/ingest.js";

// ─── Validation table ─────────────────────────────────────────────────────────

// Document types
export type {
    ValidationTableRow,
    ValidationTableAction,
    StoredValidationTable,
} from "./validation-table/schemas.js";

// Collection name + index setup
export {
    VALIDATION_TABLE_COLLECTION,
    createValidationTableIndexes,
} from "./validation-table/collections.js";
export type { ValidationTableCollectionName } from "./validation-table/collections.js";

// Validation table ingestion
export { ingestValidationTable } from "./validation-table/ingest.js";
export type {
    IngestValidationTableInput,
    IngestValidationTableResult,
} from "./validation-table/ingest.js";
