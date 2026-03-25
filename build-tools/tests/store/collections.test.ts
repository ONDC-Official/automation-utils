import { describe, it, expect } from "@jest/globals";
import { createIndexes, COLLECTIONS } from "../../src/store/collections.js";
import { createMockDb } from "./mock-db.js";

describe("COLLECTIONS", () => {
    it("exports all six collection name constants", () => {
        expect(COLLECTIONS.META).toBe("build_meta");
        expect(COLLECTIONS.DOCS).toBe("build_docs");
        expect(COLLECTIONS.FLOWS).toBe("build_flows");
        expect(COLLECTIONS.ATTRIBUTES).toBe("build_attributes");
        expect(COLLECTIONS.VALIDATIONS).toBe("build_validations");
        expect(COLLECTIONS.CHANGELOG).toBe("build_changelog");
    });
});

describe("createIndexes", () => {
    it("creates indexes on all six collections", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        // Every collection should have at least one index
        for (const name of Object.values(COLLECTIONS)) {
            const col = mock.getCollection(name);
            expect(col.indexes.length).toBeGreaterThanOrEqual(1);
        }
    });

    it("creates unique compound index on build_meta (domain + version)", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const metaCol = mock.getCollection(COLLECTIONS.META);
        const uniqueIdx = metaCol.indexes.find((i) => (i.options as { unique?: boolean }).unique);
        expect(uniqueIdx).toBeDefined();
        expect(uniqueIdx!.spec).toEqual({ domain: 1, version: 1 });
    });

    it("creates unique compound index on build_docs (domain + version + slug)", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const docsCol = mock.getCollection(COLLECTIONS.DOCS);
        const uniqueIdx = docsCol.indexes.find(
            (i) =>
                (i.options as { unique?: boolean }).unique &&
                (i.spec as Record<string, number>).slug === 1,
        );
        expect(uniqueIdx).toBeDefined();
    });

    it("creates secondary order index on build_docs", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const docsCol = mock.getCollection(COLLECTIONS.DOCS);
        const orderIdx = docsCol.indexes.find(
            (i) => (i.spec as Record<string, number>).order === 1,
        );
        expect(orderIdx).toBeDefined();
    });

    it("creates unique index on build_flows (domain + version + flowId)", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const flowsCol = mock.getCollection(COLLECTIONS.FLOWS);
        const uniqueIdx = flowsCol.indexes.find(
            (i) =>
                (i.options as { unique?: boolean }).unique &&
                (i.spec as Record<string, number>).flowId === 1,
        );
        expect(uniqueIdx).toBeDefined();
    });

    it("creates usecase+tags secondary index on build_flows", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const flowsCol = mock.getCollection(COLLECTIONS.FLOWS);
        const tagsIdx = flowsCol.indexes.find(
            (i) => (i.spec as Record<string, number>).tags === 1,
        );
        expect(tagsIdx).toBeDefined();
    });

    it("creates unique index on build_attributes (domain + version + useCaseId)", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const attrCol = mock.getCollection(COLLECTIONS.ATTRIBUTES);
        const uniqueIdx = attrCol.indexes.find(
            (i) =>
                (i.options as { unique?: boolean }).unique &&
                (i.spec as Record<string, number>).useCaseId === 1,
        );
        expect(uniqueIdx).toBeDefined();
    });

    it("creates descending generatedAt index on build_changelog", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);

        const clCol = mock.getCollection(COLLECTIONS.CHANGELOG);
        const dateIdx = clCol.indexes.find(
            (i) => (i.spec as Record<string, number>).generatedAt === -1,
        );
        expect(dateIdx).toBeDefined();
    });

    it("is idempotent (calling twice does not error)", async () => {
        const mock = createMockDb();
        await createIndexes(mock.db);
        await createIndexes(mock.db);
        // Should not throw — just creates duplicate index entries in mock
    });
});
