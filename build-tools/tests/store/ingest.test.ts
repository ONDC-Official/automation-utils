import { describe, it, expect } from "@jest/globals";
import { createHash } from "node:crypto";
import { ingestBuild } from "../../src/store/build-data/ingest.js";
import { COLLECTIONS } from "../../src/store/build-data/collections.js";
import { createMockDb } from "./mock-db.js";
import { makeConfig, makeUpdatedConfig, makeFlowConfig } from "../fixtures.js";

function hashConfig(config: unknown): string {
    return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

describe("ingestBuild", () => {
    // ─── First ingestion ─────────────────────────────────────────────────

    it("stores all collections on first ingestion", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        const result = await ingestBuild(mock.db, config);

        expect(result.skipped).toBe(false);
        if (result.skipped) return;

        expect(result.domain).toBe("ONDC:TEST01");
        expect(result.version).toBe("1.0.0");
        expect(result.buildHash).toBe(hashConfig(config));
        expect(result.changes).toBe(0); // no previous build to diff against
        expect(result.changelog).toBeNull();
    });

    it("creates meta document with correct fields", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);

        const metaCol = mock.getCollection(COLLECTIONS.META);
        expect(metaCol.docs).toHaveLength(1);

        const meta = metaCol.docs[0];
        expect(meta.domain).toBe("ONDC:TEST01");
        expect(meta.version).toBe("1.0.0");
        expect(meta.openapi).toBe("3.0.0");
        expect(meta.usecases).toEqual(["uc-alpha", "uc-beta"]);
        expect(meta.reporting).toBe(false);
        expect(meta.buildHash).toBe(hashConfig(config));
        expect(meta.ingestedAt).toBeInstanceOf(Date);
    });

    it("stores one doc per x-docs entry", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);

        const docsCol = mock.getCollection(COLLECTIONS.DOCS);
        expect(docsCol.docs).toHaveLength(2);

        const overview = docsCol.docs.find((d) => d.slug === "overview");
        expect(overview).toBeDefined();
        expect(overview!.content).toContain("# Overview");
        expect(overview!.order).toBe(0);
        expect(overview!.domain).toBe("ONDC:TEST01");
        expect(overview!.version).toBe("1.0.0");

        const releaseNotes = docsCol.docs.find((d) => d.slug === "release-notes");
        expect(releaseNotes).toBeDefined();
        expect(releaseNotes!.order).toBe(1);
    });

    it("stores one document per flow", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);

        const flowsCol = mock.getCollection(COLLECTIONS.FLOWS);
        expect(flowsCol.docs).toHaveLength(2);

        const flow1 = flowsCol.docs.find((d) => d.flowId === "flow-1");
        expect(flow1).toBeDefined();
        expect(flow1!.usecase).toBe("uc-alpha");
        expect(flow1!.tags).toEqual(["happy-path", "search"]);
        expect(flow1!.description).toBe("Basic search flow");
    });

    it("stores one document per attribute set", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);

        const attrCol = mock.getCollection(COLLECTIONS.ATTRIBUTES);
        expect(attrCol.docs).toHaveLength(2);

        const alpha = attrCol.docs.find((d) => d.useCaseId === "uc-alpha");
        expect(alpha).toBeDefined();
        expect(alpha!.attributeSet).toBeDefined();
    });

    it("stores validations document", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);

        const valCol = mock.getCollection(COLLECTIONS.VALIDATIONS);
        expect(valCol.docs).toHaveLength(1);
        expect(valCol.docs[0].validations).toEqual({ rules: ["rule-1", "rule-2"] });
    });

    // ─── Idempotency ─────────────────────────────────────────────────────

    it("skips ingestion when buildHash is unchanged", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        const first = await ingestBuild(mock.db, config);
        expect(first.skipped).toBe(false);

        const second = await ingestBuild(mock.db, config);
        expect(second.skipped).toBe(true);
        expect(second.buildHash).toBe(first.buildHash);
    });

    // ─── Update ingestion (diff + stale removal) ─────────────────────────

    it("detects changes and produces a changelog on update", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const v2 = makeConfig({
            info: { ...v1.info, version: "1.0.0", "x-reporting": true },
            "x-flows": [
                {
                    type: "playground" as const,
                    id: "flow-1",
                    usecase: "uc-alpha",
                    tags: ["happy-path", "search", "v2"],
                    description: "Updated search flow",
                    config: makeFlowConfig("flow-1"),
                },
            ],
        });

        await ingestBuild(mock.db, v1);
        const result = await ingestBuild(mock.db, v2);

        expect(result.skipped).toBe(false);
        if (result.skipped) return;

        expect(result.changes).toBeGreaterThan(0);
        expect(result.changelog).not.toBeNull();
    });

    it("removes stale flows on update", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        // v1: flow-1 (uc-alpha), flow-2 (uc-beta)

        await ingestBuild(mock.db, v1);

        const flowsCol = mock.getCollection(COLLECTIONS.FLOWS);
        expect(flowsCol.docs).toHaveLength(2);

        // v2: uc-alpha now has a new flow-3 (flow-1 dropped), uc-beta has flow-2 still
        // → flow-1 should be removed (stale within uc-alpha), flow-2 untouched (different usecase)
        const v2 = makeConfig({
            "x-flows": [
                {
                    type: "playground" as const,
                    id: "flow-3",
                    usecase: "uc-alpha",
                    tags: ["happy-path"],
                    description: "New alpha flow",
                    config: makeFlowConfig("flow-3"),
                },
                {
                    type: "playground" as const,
                    id: "flow-2",
                    usecase: "uc-beta",
                    tags: ["select"],
                    description: "Basic select flow",
                    config: makeFlowConfig("flow-2"),
                },
            ],
        });
        await ingestBuild(mock.db, v2);

        // flow-1 (uc-alpha) removed, flow-3 (uc-alpha) added, flow-2 (uc-beta) unchanged
        expect(flowsCol.docs).toHaveLength(2);
        expect(flowsCol.docs.find((d) => d.flowId === "flow-1")).toBeUndefined();
        expect(flowsCol.docs.find((d) => d.flowId === "flow-2")).toBeDefined();
        expect(flowsCol.docs.find((d) => d.flowId === "flow-3")).toBeDefined();
    });

    it("removes stale docs on update", async () => {
        const mock = createMockDb();
        const v1 = makeConfig(); // has overview + release-notes

        await ingestBuild(mock.db, v1);

        const docsCol = mock.getCollection(COLLECTIONS.DOCS);
        expect(docsCol.docs).toHaveLength(2);

        // v2 only has overview
        const v2 = makeConfig({
            "x-docs": { overview: "# Updated Overview" },
        });
        await ingestBuild(mock.db, v2);

        expect(docsCol.docs).toHaveLength(1);
        expect(docsCol.docs[0].slug).toBe("overview");
        expect(docsCol.docs[0].content).toBe("# Updated Overview");
    });

    it("handles config with no x-docs", async () => {
        const mock = createMockDb();
        const config = makeConfig({ "x-docs": undefined });

        const result = await ingestBuild(mock.db, config);
        expect(result.skipped).toBe(false);

        const docsCol = mock.getCollection(COLLECTIONS.DOCS);
        expect(docsCol.docs).toHaveLength(0);
    });

    // ─── Changelog storage ───────────────────────────────────────────────

    it("stores changelog document in build_changelog on update", async () => {
        const mock = createMockDb();
        const v1 = makeConfig();
        const v2 = makeConfig({
            info: { ...v1.info, version: "1.0.0", title: "Changed Title" },
        });

        await ingestBuild(mock.db, v1);
        await ingestBuild(mock.db, v2);

        const clCol = mock.getCollection(COLLECTIONS.CHANGELOG);
        // Changelog should exist since there's a title change
        expect(clCol.docs.length).toBeGreaterThanOrEqual(1);
    });

    it("does not store changelog on first ingestion", async () => {
        const mock = createMockDb();
        await ingestBuild(mock.db, makeConfig());

        const clCol = mock.getCollection(COLLECTIONS.CHANGELOG);
        expect(clCol.docs).toHaveLength(0);
    });

    // ─── Return value shape ──────────────────────────────────────────────

    it("returns correct IngestResult shape on success", async () => {
        const mock = createMockDb();
        const config = makeConfig();
        const result = await ingestBuild(mock.db, config);

        expect(result).toHaveProperty("skipped", false);
        expect(result).toHaveProperty("domain", "ONDC:TEST01");
        expect(result).toHaveProperty("version", "1.0.0");
        expect(result).toHaveProperty("buildHash");
        if (!result.skipped) {
            expect(result).toHaveProperty("changes");
            expect(result).toHaveProperty("changelog");
        }
    });

    it("returns correct IngestResult shape on skip", async () => {
        const mock = createMockDb();
        const config = makeConfig();

        await ingestBuild(mock.db, config);
        const result = await ingestBuild(mock.db, config);

        expect(result).toHaveProperty("skipped", true);
        expect(result).toHaveProperty("domain", "ONDC:TEST01");
        expect(result).toHaveProperty("version", "1.0.0");
        expect(result).toHaveProperty("buildHash");
    });
});
