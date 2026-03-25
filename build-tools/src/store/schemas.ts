/**
 * Stored document types for MongoDB collections.
 *
 * Each type maps to a single MongoDB collection and represents a slice of a
 * parsed `BuildConfig`. The full config is intentionally split across multiple
 * collections so consumers can query individual sections (flows, attributes,
 * docs, etc.) without loading the entire build.
 */

import type { ChangeLog } from "../change-logs/types.js";

// ─── Common ──────────────────────────────────────────────────────────────────

/** Shared fields present on every stored document that belongs to a build. */
export interface DomainVersion {
    domain: string;
    version: string;
}

// ─── Build Meta ──────────────────────────────────────────────────────────────

/**
 * Top-level build metadata — everything from `BuildConfig` *except* the large
 * sub-collections (x-docs, x-flows, x-attributes, x-validations) which are
 * stored separately.
 */
export interface StoredBuildMeta extends DomainVersion {
    openapi: string;
    title?: string;
    description?: string;
    usecases: string[];
    branchName?: string;
    reporting: boolean;
    security?: Record<string, string[]>[];
    paths: Record<string, Record<string, unknown>>;
    components: Record<string, unknown>;
    errorCodes: { Event: string; Description: string; From: string; code: string | number }[];
    supportedActions: Record<string, string[]>;
    apiProperties: Record<
        string,
        { async_predecessor: string | null; transaction_partner: string[] }
    >;

    /** SHA-256 hex digest of the full JSON-stringified BuildConfig. */
    buildHash: string;
    ingestedAt: Date;
}

// ─── Docs ────────────────────────────────────────────────────────────────────

/** One markdown document from `x-docs`. */
export interface StoredBuildDoc extends DomainVersion {
    slug: string;
    content: string;
    /** Insertion order derived from `Object.entries(x-docs)`. */
    order: number;
    updatedAt: Date;
}

// ─── Flows ───────────────────────────────────────────────────────────────────

/** One flow entry from `x-flows`. */
export interface StoredBuildFlow extends DomainVersion {
    flowId: string;
    usecase: string;
    tags: string[];
    description: string;
    /** Full flow config — kept as opaque JSON to avoid coupling to mock-runner types. */
    config: unknown;
    updatedAt: Date;
}

// ─── Attributes ──────────────────────────────────────────────────────────────

/** One attribute set from `x-attributes`, keyed by use-case. */
export interface StoredBuildAttribute extends DomainVersion {
    useCaseId: string;
    attributeSet: Record<string, unknown>;
    updatedAt: Date;
}

// ─── Validations ─────────────────────────────────────────────────────────────

/** Domain validations — stored as-is since the schema is `unknown`. */
export interface StoredBuildValidation extends DomainVersion {
    validations: unknown;
    updatedAt: Date;
}

// ─── Change Log ──────────────────────────────────────────────────────────────

/**
 * Extends the existing `ChangeLog` type with identifiers needed for
 * querying changelogs by domain, version range, or date.
 */
export interface StoredChangeLog extends ChangeLog, DomainVersion {
    fromVersion: string;
    toVersion: string;
    branch?: string;
    totalChanges: number;
}
