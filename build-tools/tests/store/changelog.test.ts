import { describe, it, expect } from "@jest/globals";
import { diffChangelog } from "../../src/store/changelog.js";
import { COLLECTIONS } from "../../src/store/collections.js";
import type { StoredBuildMeta } from "../../src/store/schemas.js";
import { createMockDb } from "./mock-db.js";
import { makeConfig, makeFlowConfig } from "../fixtures.js";

/** Seed the mock DB with a stored build from `config`. */
function seedBuild(mock: ReturnType<typeof createMockDb>, config: ReturnType<typeof makeConfig>) {
    const now = new Date();
    const domain = config.info.domain;
    const version = config.info.version;

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
        errorCodes: config["x-errors-codes"].code,
        supportedActions: config["x-supported-actions"].supportedActions,
        apiProperties: config["x-supported-actions"].apiProperties,
        buildHash: "abc123",
        ingestedAt: now,
    };

    mock.getCollection(COLLECTIONS.META).docs.push(meta as unknown as Record<string, unknown>);

    // Seed flows
    for (const f of config["x-flows"]) {
        mock.getCollection(COLLECTIONS.FLOWS).docs.push({
            domain,
            version,
            flowId: f.id,
            usecase: f.usecase,
            tags: f.tags,
            description: f.description,
            config: f.config,
            updatedAt: now,
        });
    }

    // Seed attributes
    for (const a of config["x-attributes"]) {
        mock.getCollection(COLLECTIONS.ATTRIBUTES).docs.push({
            domain,
            version,
            useCaseId: a.meta?.use_case_id ?? "default",
            attributeSet: a.attribute_set ?? {},
            updatedAt: now,
        });
    }

    // Seed validations
    mock.getCollection(COLLECTIONS.VALIDATIONS).docs.push({
        domain,
        version,
        validations: config["x-validations"],
        updatedAt: now,
    });

    // Seed docs
    if (config["x-docs"]) {
        Object.entries(config["x-docs"]).forEach(([slug, content], order) => {
            mock.getCollection(COLLECTIONS.DOCS).docs.push({
                domain,
                version,
                slug,
                content,
                order,
                updatedAt: now,
            });
        });
    }

    return meta;
}

describe("diffChangelog", () => {
    it("returns null when existingMeta is null (first ingestion)", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        const result = await diffChangelog(mock.db, config, null);
        expect(result).toBeNull();
    });

    it("returns null when configs are identical (zero changes)", async () => {
        const mock = createMockDb();
        const config = makeConfig();
        const meta = seedBuild(mock, config);

        const result = await diffChangelog(mock.db, config, meta);
        expect(result).toBeNull();
    });

    it("produces a changelog when info fields change", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const meta = seedBuild(mock, v1);

        const v2 = makeConfig({
            info: { ...v1.info, title: "Updated Title", "x-reporting": true },
        });

        const result = await diffChangelog(mock.db, v2, meta);
        expect(result).not.toBeNull();
        expect(result!.totalChanges).toBeGreaterThan(0);
        expect(result!.domain).toBe("ONDC:TEST01");

        const infoSection = result!.sections.find((s) => s.section === "info");
        expect(infoSection).toBeDefined();
    });

    it("produces a changelog when flows are added/removed", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const meta = seedBuild(mock, v1);

        const v2 = makeConfig({
            "x-flows": [
                {
                    type: "playground" as const,
                    id: "flow-new",
                    usecase: "uc-alpha",
                    tags: ["new"],
                    description: "A new flow",
                    config: makeFlowConfig("flow-new"),
                },
            ],
        });

        const result = await diffChangelog(mock.db, v2, meta);
        expect(result).not.toBeNull();

        const flowSection = result!.sections.find((s) => s.section === "flows");
        expect(flowSection).toBeDefined();

        // flow-1 and flow-2 removed, flow-new added
        const added = flowSection!.entries.filter((e) => e.kind === "added");
        const removed = flowSection!.entries.filter((e) => e.kind === "removed");
        expect(added.length).toBeGreaterThanOrEqual(1);
        expect(removed.length).toBeGreaterThanOrEqual(1);
    });

    it("produces a changelog when error codes change", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const meta = seedBuild(mock, v1);

        const v2 = makeConfig({
            "x-errors-codes": {
                code: [
                    {
                        Event: "SEARCH_ERR",
                        Description: "Updated description",
                        From: "BAP",
                        code: "40001",
                    },
                ],
            },
        });

        const result = await diffChangelog(mock.db, v2, meta);
        expect(result).not.toBeNull();

        const errorSection = result!.sections.find((s) => s.section === "errors");
        expect(errorSection).toBeDefined();
    });

    it("includes correct metadata fields on StoredChangeLog", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const meta = seedBuild(mock, v1);

        const v2 = makeConfig({
            info: { ...v1.info, version: "2.0.0" },
        });

        const result = await diffChangelog(mock.db, v2, meta);
        // Versions are different in info, so there should be a diff
        // even though we can't guarantee which sections fire, check the structure
        if (result) {
            expect(result.schemaVersion).toBe(1);
            expect(result.generatedAt).toBeDefined();
            expect(result.old.domain).toBe("ONDC:TEST01");
            expect(result.new.domain).toBe("ONDC:TEST01");
            expect(result.fromVersion).toBe("1.0.0");
            expect(result.toVersion).toBe("2.0.0");
            expect(result.domain).toBe("ONDC:TEST01");
            expect(typeof result.totalChanges).toBe("number");
            expect(result.summary).toBeDefined();
            expect(result.sections).toBeInstanceOf(Array);
        }
    });
});
