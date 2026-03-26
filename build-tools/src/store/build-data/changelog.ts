/**
 * Changelog diffing for build ingestion.
 *
 * Compares an incoming `BuildConfig` against the previously stored build to
 * produce a `StoredChangeLog`. Delegates to the existing section-level diff
 * functions in `change-logs/diff.ts` so diffing logic is never duplicated.
 */

import type { Db } from "mongodb";
import type { BuildConfig } from "../../types/build-type.js";
import type { ChangeSection } from "../../change-logs/types.js";
import {
    diffInfo,
    diffFlows,
    diffAttributes,
    diffErrors,
    diffActions,
    diffPaths,
} from "../../change-logs/diff.js";
import { COLLECTIONS } from "./collections.js";
import type { StoredBuildMeta, StoredChangeLog } from "./schemas.js";

// ─── Reconstruct a minimal BuildConfig from stored data ──────────────────────

/**
 * Rebuilds a `BuildConfig`-shaped object from the stored collections so it can
 * be passed to the existing diff functions. Only the fields that the diff
 * functions inspect are populated.
 */
async function reconstructConfig(db: Db, meta: StoredBuildMeta): Promise<BuildConfig> {
    const { domain, version } = meta;
    const filter = { domain, version };

    const [flows, attributes, validations, docs] = await Promise.all([
        db.collection(COLLECTIONS.FLOWS).find(filter).toArray(),
        db.collection(COLLECTIONS.ATTRIBUTES).find(filter).toArray(),
        db.collection(COLLECTIONS.VALIDATIONS).findOne(filter),
        db.collection(COLLECTIONS.DOCS).find(filter).sort({ order: 1 }).toArray(),
    ]);

    return {
        openapi: meta.openapi,
        info: {
            domain: meta.domain,
            version: meta.version,
            "x-usecases": meta.usecases,
            "x-reporting": meta.reporting,
            ...(meta.title !== undefined && { title: meta.title }),
            ...(meta.description !== undefined && { description: meta.description }),
            ...(meta.branchName !== undefined && { "x-branch-name": meta.branchName }),
        },
        security: meta.security,
        paths: meta.paths,
        components: meta.components,
        "x-errorcodes": { code: meta.errorCodes },
        "x-supported-actions": {
            supportedActions: meta.supportedActions,
            apiProperties: meta.apiProperties,
        },
        "x-flows": flows.map((f) => ({
            type: "playground" as const,
            id: f.flowId as string,
            usecase: f.usecase as string,
            tags: f.tags as string[],
            description: f.description as string,
            config: f.config,
        })),
        "x-attributes": attributes.map((a) => ({
            meta: { use_case_id: a.useCaseId as string },
            attribute_set: a.attributeSet as Record<string, unknown>,
        })),
        "x-validations": validations?.validations,
        ...(docs.length > 0 && {
            "x-docs": Object.fromEntries(docs.map((d) => [d.slug as string, d.content as string])),
        }),
    } as BuildConfig;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Produces a `StoredChangeLog` by diffing `config` against the existing build
 * identified by `existingMeta`.
 *
 * Returns `null` on first ingestion (no previous build to diff against).
 */
export async function diffChangelog(
    db: Db,
    config: BuildConfig,
    existingMeta: StoredBuildMeta | null,
): Promise<StoredChangeLog | null> {
    if (!existingMeta) return null;

    const oldConfig = await reconstructConfig(db, existingMeta);

    const rawSections: (ChangeSection | null)[] = [
        diffInfo(oldConfig, config),
        diffFlows(oldConfig, config),
        diffAttributes(oldConfig, config),
        diffErrors(oldConfig, config),
        diffActions(oldConfig, config),
        diffPaths(oldConfig, config),
    ];

    const sections = rawSections.filter((s): s is ChangeSection => s !== null);
    const totalChanges = sections.reduce((sum, s) => sum + s.totalChanges, 0);

    if (totalChanges === 0) return null;

    const now = new Date().toISOString();

    return {
        // ChangeLog fields
        schemaVersion: 1,
        generatedAt: now,
        old: {
            domain: existingMeta.domain,
            version: existingMeta.version,
            branch: existingMeta.branchName,
        },
        new: {
            domain: config.info.domain,
            version: config.info.version,
            branch: config.info["x-branch-name"],
        },
        summary: {
            totalChanges,
            sections: sections.map((s) => ({
                section: s.section,
                label: s.label,
                count: s.totalChanges,
            })),
        },
        sections,

        // StoredChangeLog extensions
        domain: config.info.domain,
        version: config.info.version,
        fromVersion: existingMeta.version,
        toVersion: config.info.version,
        branch: config.info["x-branch-name"],
        totalChanges,
    };
}
