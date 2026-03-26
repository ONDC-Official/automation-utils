/**
 * Build ingestion — the main entry point for storing a parsed `BuildConfig`
 * into MongoDB.
 *
 * Usage:
 * ```ts
 * import { ingestBuild } from "@ondc/build-tools/store";
 *
 * const result = await ingestBuild(db, parsedConfig);
 * if (result.skipped) {
 *     console.log("Build already ingested (identical hash).");
 * } else {
 *     console.log(`Ingested ${result.domain}@${result.version} — ${result.changes} changes`);
 * }
 * ```
 */

import { createHash } from "node:crypto";
import type { Db } from "mongodb";

import type {
    StoredBuildMeta,
    StoredBuildDoc,
    StoredBuildFlow,
    StoredBuildAttribute,
    StoredBuildValidation,
    StoredChangeLog,
} from "./schemas.js";
import { BuildConfig, COLLECTIONS, diffChangelog } from "../../lib.js";

// ─── Result types ────────────────────────────────────────────────────────────

export type IngestResult =
    | { skipped: true; domain: string; version: string; buildHash: string }
    | {
          skipped: false;
          domain: string;
          version: string;
          buildHash: string;
          changes: number;
          changelog: StoredChangeLog | null;
      };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeBuildHash(config: BuildConfig): string {
    return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

// ─── Ingest ──────────────────────────────────────────────────────────────────

/**
 * Stores a parsed `BuildConfig` into MongoDB, split across multiple
 * collections. Idempotent — if the build hash hasn't changed, the write is
 * skipped entirely.
 *
 * @param db - A connected MongoDB `Db` instance. The caller owns the connection.
 * @param config - A fully parsed and validated `BuildConfig`.
 * @returns An `IngestResult` indicating whether the build was stored or skipped.
 */
export async function ingestBuild(db: Db, config: BuildConfig): Promise<IngestResult> {
    const domain = config.info.domain;
    const version = config.info.version;
    const buildHash = computeBuildHash(config);
    const filter = { domain, version };

    // ── Early exit if build hash is unchanged ───────────────────────────────
    const existingMeta = await db
        .collection<StoredBuildMeta>(COLLECTIONS.META)
        .findOne(filter, { projection: { buildHash: 1, _id: 0 } });

    if (existingMeta?.buildHash === buildHash) {
        return { skipped: true, domain, version, buildHash };
    }

    // ── Fetch full existing meta for changelog diffing ──────────────────────
    const fullExistingMeta = existingMeta
        ? await db.collection<StoredBuildMeta>(COLLECTIONS.META).findOne(filter)
        : null;

    // ── Diff changelog against previous build ───────────────────────────────
    const changelog = await diffChangelog(db, config, fullExistingMeta);

    const now = new Date();

    // ── Upsert meta ─────────────────────────────────────────────────────────
    const meta: StoredBuildMeta = {
        domain,
        version,
        openapi: config.openapi,
        title: config.info.title,
        description: config.info.description,
        usecases: config.info["x-usecases"],
        branchName: config.info["x-branch-name"],
        reporting: config.info["x-reporting"],
        security: config.security,
        paths: config.paths,
        components: config.components as Record<string, unknown>,
        errorCodes: config["x-errorcodes"].code,
        supportedActions: config["x-supported-actions"].supportedActions,
        apiProperties: config["x-supported-actions"].apiProperties,
        buildHash,
        ingestedAt: now,
    };

    await db
        .collection<StoredBuildMeta>(COLLECTIONS.META)
        .replaceOne(filter, meta, { upsert: true });

    // ── Upsert docs (bulkWrite + remove stale) ─────────────────────────────
    const docEntries = Object.entries(config["x-docs"] ?? {});
    const docSlugs = docEntries.map(([slug]) => slug);

    if (docEntries.length > 0) {
        const docOps = docEntries.map(([slug, content], order) => ({
            updateOne: {
                filter: { domain, version, slug },
                update: {
                    $set: {
                        domain,
                        version,
                        slug,
                        content,
                        order,
                        updatedAt: now,
                    } satisfies StoredBuildDoc,
                },
                upsert: true,
            },
        }));
        await db.collection(COLLECTIONS.DOCS).bulkWrite(docOps);
    }
    // Remove docs that no longer exist in the config
    await db
        .collection(COLLECTIONS.DOCS)
        .deleteMany({ domain, version, ...(docSlugs.length > 0 && { slug: { $nin: docSlugs } }) });

    // ── Upsert flows (bulkWrite + remove stale) ────────────────────────────
    const flows = config["x-flows"];
    const flowIds = flows.map((f) => f.id);

    if (flows.length > 0) {
        const flowOps = flows.map((f) => ({
            updateOne: {
                filter: { domain, version, flowId: f.id },
                update: {
                    $set: {
                        domain,
                        version,
                        flowId: f.id,
                        usecase: f.usecase,
                        tags: f.tags,
                        description: f.description,
                        config: f.config,
                        updatedAt: now,
                    } satisfies StoredBuildFlow,
                },
                upsert: true,
            },
        }));
        await db.collection(COLLECTIONS.FLOWS).bulkWrite(flowOps);
    }
    await db
        .collection(COLLECTIONS.FLOWS)
        .deleteMany({ domain, version, ...(flowIds.length > 0 && { flowId: { $nin: flowIds } }) });

    // ── Upsert attributes ───────────────────────────────────────────────────
    const attributes = config["x-attributes"];
    const useCaseIds = attributes.map((a) => a.meta?.use_case_id ?? "default");

    if (attributes.length > 0) {
        const attrOps = attributes.map((a) => {
            const useCaseId = a.meta?.use_case_id ?? "default";
            return {
                updateOne: {
                    filter: { domain, version, useCaseId },
                    update: {
                        $set: {
                            domain,
                            version,
                            useCaseId,
                            attributeSet: (a.attribute_set ?? {}) as Record<string, unknown>,
                            updatedAt: now,
                        } satisfies StoredBuildAttribute,
                    },
                    upsert: true,
                },
            };
        });
        await db.collection(COLLECTIONS.ATTRIBUTES).bulkWrite(attrOps);
    }
    await db.collection(COLLECTIONS.ATTRIBUTES).deleteMany({
        domain,
        version,
        ...(useCaseIds.length > 0 && { useCaseId: { $nin: useCaseIds } }),
    });

    // ── Upsert validations ──────────────────────────────────────────────────
    const validationDoc: StoredBuildValidation = {
        domain,
        version,
        validations: config["x-validations"],
        updatedAt: now,
    };
    await db
        .collection<StoredBuildValidation>(COLLECTIONS.VALIDATIONS)
        .replaceOne(filter, validationDoc, { upsert: true });

    // ── Insert changelog ────────────────────────────────────────────────────
    if (changelog) {
        await db
            .collection<StoredChangeLog>(COLLECTIONS.CHANGELOG)
            .replaceOne(
                { domain, fromVersion: changelog.fromVersion, toVersion: changelog.toVersion },
                changelog,
                { upsert: true },
            );
    }

    return {
        skipped: false,
        domain,
        version,
        buildHash,
        changes: changelog?.totalChanges ?? 0,
        changelog,
    };
}
