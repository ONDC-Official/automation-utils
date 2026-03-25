/**
 * Lightweight in-memory mock of MongoDB's `Db` and `Collection` for unit tests.
 *
 * This avoids needing a real MongoDB instance while still testing the logic
 * of createIndexes, ingestBuild, and diffChangelog.
 */

import type { Db } from "mongodb";

type Doc = Record<string, unknown>;

interface MockCollection {
    name: string;
    docs: Doc[];
    indexes: { spec: Doc; options: Doc }[];

    // Tracked operations for assertions
    operations: { type: string; args: unknown[] }[];
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
    for (const [key, val] of Object.entries(filter)) {
        if (key === "$nin" || key === "$in") continue;
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            const opObj = val as Record<string, unknown>;
            if ("$nin" in opObj) {
                if ((opObj.$nin as unknown[]).includes(doc[key])) return false;
                continue;
            }
            if ("$in" in opObj) {
                if (!(opObj.$in as unknown[]).includes(doc[key])) return false;
                continue;
            }
        }
        if (doc[key] !== val) return false;
    }
    return true;
}

function createMockCollection(name: string): MockCollection {
    return { name, docs: [], indexes: [], operations: [] };
}

export interface MockDb {
    db: Db;
    collections: Map<string, MockCollection>;
    getCollection(name: string): MockCollection;
}

export function createMockDb(): MockDb {
    const collections = new Map<string, MockCollection>();

    function getOrCreate(name: string): MockCollection {
        if (!collections.has(name)) {
            collections.set(name, createMockCollection(name));
        }
        return collections.get(name)!;
    }

    const db = {
        collection(name: string) {
            const col = getOrCreate(name);

            return {
                createIndex(spec: Doc, options: Doc = {}) {
                    col.indexes.push({ spec, options });
                    col.operations.push({ type: "createIndex", args: [spec, options] });
                    return Promise.resolve("ok");
                },

                findOne(filter: Doc, options?: { projection?: Doc }) {
                    col.operations.push({ type: "findOne", args: [filter, options] });
                    const found = col.docs.find((d) => matchesFilter(d, filter));
                    if (!found) return Promise.resolve(null);
                    if (options?.projection) {
                        const projected: Doc = {};
                        for (const key of Object.keys(options.projection)) {
                            if (options.projection[key] === 1) projected[key] = found[key];
                        }
                        return Promise.resolve(projected);
                    }
                    return Promise.resolve({ ...found });
                },

                find(filter: Doc) {
                    const results = col.docs.filter((d) => matchesFilter(d, filter));
                    col.operations.push({ type: "find", args: [filter] });
                    return {
                        sort(_spec: Doc) {
                            return this;
                        },
                        toArray() {
                            return Promise.resolve(results.map((d) => ({ ...d })));
                        },
                    };
                },

                replaceOne(filter: Doc, doc: Doc, options?: { upsert?: boolean }) {
                    col.operations.push({ type: "replaceOne", args: [filter, doc, options] });
                    const idx = col.docs.findIndex((d) => matchesFilter(d, filter));
                    if (idx >= 0) {
                        col.docs[idx] = { ...doc };
                    } else if (options?.upsert) {
                        col.docs.push({ ...doc });
                    }
                    return Promise.resolve({ modifiedCount: idx >= 0 ? 1 : 0, upsertedCount: idx < 0 ? 1 : 0 });
                },

                bulkWrite(ops: { updateOne: { filter: Doc; update: { $set: Doc }; upsert?: boolean } }[]) {
                    col.operations.push({ type: "bulkWrite", args: [ops] });
                    for (const op of ops) {
                        const { filter, update, upsert } = op.updateOne;
                        const idx = col.docs.findIndex((d) => matchesFilter(d, filter));
                        if (idx >= 0) {
                            Object.assign(col.docs[idx], update.$set);
                        } else if (upsert) {
                            col.docs.push({ ...update.$set });
                        }
                    }
                    return Promise.resolve({ ok: 1 });
                },

                deleteMany(filter: Doc) {
                    col.operations.push({ type: "deleteMany", args: [filter] });
                    const before = col.docs.length;
                    col.docs = col.docs.filter((d) => !matchesFilter(d, filter));
                    return Promise.resolve({ deletedCount: before - col.docs.length });
                },
            };
        },
    } as unknown as Db;

    return {
        db,
        collections,
        getCollection(name: string) {
            return getOrCreate(name);
        },
    };
}
