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
} from "./schemas.js";

// Collection names + index setup
export { COLLECTIONS, createIndexes } from "./collections.js";
export type { CollectionName } from "./collections.js";

// Changelog diffing
export { diffChangelog } from "./changelog.js";

// Build ingestion (main entry point)
export { ingestBuild } from "./ingest.js";
export type { IngestResult } from "./ingest.js";
