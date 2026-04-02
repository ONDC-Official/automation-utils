/**
 * MongoDB collection names and index definitions.
 *
 * Call `createIndexes(db)` once during application startup to ensure all
 * required indexes exist. The function is idempotent — MongoDB silently
 * skips indexes that already exist.
 */

import type { Db } from "mongodb";

// ─── Collection names ────────────────────────────────────────────────────────

export const COLLECTIONS = {
    META: "build_meta",
    DOCS: "build_docs",
    FLOWS: "build_flows",
    ATTRIBUTES: "build_attributes",
    VALIDATIONS: "build_validations",
    CHANGELOG: "build_changelog",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

// ─── Index creation ──────────────────────────────────────────────────────────

/**
 * Creates all required indexes across build collections.
 *
 * - Unique compound indexes on `domain + version` (or `domain + version + key`)
 *   guarantee at most one document per build per entity.
 * - Secondary indexes support common query patterns (docs by order, flows by
 *   usecase/tags, changelogs by date).
 */
export async function createIndexes(db: Db): Promise<void> {
    // ── build_meta ──────────────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.META)
        .createIndex({ domain: 1, version: 1 }, { unique: true, name: "uq_domain_version" });

    // ── build_docs ──────────────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.DOCS)
        .createIndex(
            { domain: 1, version: 1, slug: 1 },
            { unique: true, name: "uq_domain_version_slug" },
        );
    await db
        .collection(COLLECTIONS.DOCS)
        .createIndex({ domain: 1, version: 1, order: 1 }, { name: "idx_domain_version_order" });

    // ── build_flows ─────────────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.FLOWS)
        .createIndex(
            { domain: 1, version: 1, usecase: 1, flowId: 1 },
            { unique: true, name: "uq_domain_version_usecase_flowId" },
        );
    await db
        .collection(COLLECTIONS.FLOWS)
        .createIndex(
            { domain: 1, version: 1, usecase: 1, tags: 1 },
            { name: "idx_domain_version_usecase_tags" },
        );

    // ── build_attributes ────────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.ATTRIBUTES)
        .createIndex(
            { domain: 1, version: 1, useCaseId: 1 },
            { unique: true, name: "uq_domain_version_useCaseId" },
        );

    // ── build_validations ───────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.VALIDATIONS)
        .createIndex({ domain: 1, version: 1 }, { unique: true, name: "uq_domain_version" });

    // ── build_changelog ─────────────────────────────────────────────────────
    await db
        .collection(COLLECTIONS.CHANGELOG)
        .createIndex(
            { domain: 1, fromVersion: 1, toVersion: 1 },
            { unique: true, name: "uq_domain_from_to" },
        );
    await db
        .collection(COLLECTIONS.CHANGELOG)
        .createIndex({ domain: 1, generatedAt: -1 }, { name: "idx_domain_generatedAt_desc" });
}
