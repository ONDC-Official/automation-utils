import { describe, it, expect } from "@jest/globals";
import type { BuildConfig } from "../../src/types/build-type.js";
import {
    diffInfo,
    diffFlows,
    diffAttributes,
    diffErrors,
    diffActions,
    diffPaths,
    MAX_ENTRIES_PER_SECTION,
} from "../../src/change-logs/diff.js";
import { makeConfig, makeUpdatedConfig, makeFlowConfig } from "../fixtures.js";

// ─── diffInfo ────────────────────────────────────────────────────────────────

describe("diffInfo", () => {
    it("returns null when configs are identical", () => {
        const c = makeConfig();
        expect(diffInfo(c, c)).toBeNull();
    });

    it("detects modified scalar fields", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            info: { ...oldC.info, title: "New Title", "x-reporting": true },
        });
        const section = diffInfo(oldC, newC)!;
        expect(section).not.toBeNull();
        expect(section.section).toBe("info");

        const titleEntry = section.entries.find((e) => e.path === "info.title");
        expect(titleEntry).toBeDefined();
        expect(titleEntry!.kind).toBe("modified");
        expect(titleEntry!.before).toBe("Test Domain");
        expect(titleEntry!.after).toBe("New Title");

        const reportingEntry = section.entries.find((e) => e.path === "info.x-reporting");
        expect(reportingEntry).toBeDefined();
        expect(reportingEntry!.kind).toBe("modified");
    });

    it("detects added and removed usecases", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            info: {
                ...oldC.info,
                "x-usecases": ["uc-alpha", "uc-gamma"], // uc-beta removed, uc-gamma added
            },
        });
        const section = diffInfo(oldC, newC)!;
        expect(section).not.toBeNull();

        const added = section.entries.filter((e) => e.kind === "added");
        const removed = section.entries.filter((e) => e.kind === "removed");
        expect(added).toHaveLength(1);
        expect(added[0].summary).toContain("uc-gamma");
        expect(removed).toHaveLength(1);
        expect(removed[0].summary).toContain("uc-beta");
    });
});

// ─── diffFlows ───────────────────────────────────────────────────────────────

describe("diffFlows", () => {
    it("returns null when flows are identical", () => {
        const c = makeConfig();
        expect(diffFlows(c, c)).toBeNull();
    });

    it("detects added, removed, and modified flows", () => {
        const oldC = makeConfig();
        const newC = makeUpdatedConfig();
        const section = diffFlows(oldC, newC)!;
        expect(section).not.toBeNull();
        expect(section.section).toBe("flows");

        // flow-1 modified (description + tag)
        const descChange = section.entries.find((e) => e.path === "x-flows.flow-1.description");
        expect(descChange).toBeDefined();
        expect(descChange!.kind).toBe("modified");

        const tagAdded = section.entries.find(
            (e) => e.path === "x-flows.flow-1.tags" && e.kind === "added",
        );
        expect(tagAdded).toBeDefined();
        expect(tagAdded!.summary).toContain("v2");

        // flow-2 removed
        const removed = section.entries.find(
            (e) => e.path === "x-flows.flow-2" && e.kind === "removed",
        );
        expect(removed).toBeDefined();

        // flow-3 added
        const added = section.entries.find(
            (e) => e.path === "x-flows.flow-3" && e.kind === "added",
        );
        expect(added).toBeDefined();
    });

    it("detects usecase changes on a flow", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            "x-flows": [
                {
                    type: "playground",
                    id: "flow-1",
                    usecase: "uc-changed",
                    tags: ["happy-path", "search"],
                    description: "Basic search flow",
                    config: makeFlowConfig("flow-1"),
                },
            ],
        });
        const section = diffFlows(oldC, newC)!;
        const ucChange = section.entries.find((e) => e.path === "x-flows.flow-1.usecase");
        expect(ucChange).toBeDefined();
        expect(ucChange!.kind).toBe("modified");
        expect(ucChange!.before).toBe("uc-alpha");
        expect(ucChange!.after).toBe("uc-changed");
    });
});

// ─── diffAttributes ──────────────────────────────────────────────────────────

describe("diffAttributes", () => {
    it("returns null when attributes are identical", () => {
        const c = makeConfig();
        expect(diffAttributes(c, c)).toBeNull();
    });

    it("detects added attribute use-case", () => {
        const oldC = makeConfig({ "x-attributes": [] });
        const newC = makeConfig();
        const section = diffAttributes(oldC, newC)!;
        expect(section).not.toBeNull();

        const added = section.entries.filter((e) => e.kind === "added");
        expect(added.length).toBeGreaterThanOrEqual(2); // uc-alpha + uc-beta
    });

    it("detects removed attribute use-case", () => {
        const oldC = makeConfig();
        const newC = makeConfig({ "x-attributes": [] });
        const section = diffAttributes(oldC, newC)!;

        const removed = section.entries.filter((e) => e.kind === "removed");
        expect(removed.length).toBeGreaterThanOrEqual(2);
    });

    it("detects modified attribute leaf", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            "x-attributes": [
                {
                    meta: { use_case_id: "uc-alpha" },
                    attribute_set: {
                        search: {
                            message: {
                                intent: {
                                    _description: {
                                        required: false, // changed from true
                                        usage: "optional",
                                        info: "Search intent",
                                        owner: "BAP",
                                        type: "string", // changed from object
                                    },
                                },
                            },
                        },
                    },
                },
                oldC["x-attributes"][1], // keep uc-beta unchanged
            ],
        });
        const section = diffAttributes(oldC, newC)!;
        expect(section).not.toBeNull();

        const modified = section.entries.filter((e) => e.kind === "modified");
        expect(modified.length).toBeGreaterThanOrEqual(1);
        expect(modified[0].before).toContain("required=true");
        expect(modified[0].after).toContain("required=false");
    });
});

// ─── diffErrors ──────────────────────────────────────────────────────────────

describe("diffErrors", () => {
    it("returns null when error codes are identical", () => {
        const c = makeConfig();
        expect(diffErrors(c, c)).toBeNull();
    });

    it("detects added, removed, and modified error codes", () => {
        const oldC = makeConfig();
        const newC = makeUpdatedConfig();
        const section = diffErrors(oldC, newC)!;
        expect(section).not.toBeNull();
        expect(section.section).toBe("errors");

        // 40001 modified
        const modified = section.entries.find(
            (e) => e.path === "x-errors-codes.40001" && e.kind === "modified",
        );
        expect(modified).toBeDefined();

        // 40002 removed
        const removed = section.entries.find(
            (e) => e.path === "x-errors-codes.40002" && e.kind === "removed",
        );
        expect(removed).toBeDefined();

        // 40003 added
        const added = section.entries.find(
            (e) => e.path === "x-errors-codes.40003" && e.kind === "added",
        );
        expect(added).toBeDefined();
    });
});

// ─── diffActions ─────────────────────────────────────────────────────────────

describe("diffActions", () => {
    it("returns null when actions are identical", () => {
        const c = makeConfig();
        expect(diffActions(c, c)).toBeNull();
    });

    it("detects added and removed actions", () => {
        const oldC = makeConfig();
        const newC = makeUpdatedConfig();
        const section = diffActions(oldC, newC)!;
        expect(section).not.toBeNull();
        expect(section.section).toBe("actions");

        const added = section.entries.find(
            (e) => e.path === "x-supported-actions.confirm" && e.kind === "added",
        );
        expect(added).toBeDefined();
    });

    it("detects added/removed next-actions within existing action", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            "x-supported-actions": {
                supportedActions: {
                    search: ["on_search", "on_search_inc"], // on_search_inc added
                    select: [], // on_select removed
                },
                apiProperties: oldC["x-supported-actions"].apiProperties,
            },
        });
        const section = diffActions(oldC, newC)!;
        expect(section).not.toBeNull();

        const addedNext = section.entries.find(
            (e) => e.kind === "added" && e.summary.includes("on_search_inc"),
        );
        expect(addedNext).toBeDefined();

        const removedNext = section.entries.find(
            (e) => e.kind === "removed" && e.summary.includes("on_select"),
        );
        expect(removedNext).toBeDefined();
    });
});

// ─── diffPaths ───────────────────────────────────────────────────────────────

describe("diffPaths", () => {
    it("returns null when paths are identical", () => {
        const c = makeConfig();
        expect(diffPaths(c, c)).toBeNull();
    });

    it("detects added and removed paths", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            paths: {
                "/search": { post: { description: "Search" } },
                "/confirm": { post: { description: "Confirm" } }, // added
                // /select removed
            },
        });
        const section = diffPaths(oldC, newC)!;
        expect(section).not.toBeNull();

        const added = section.entries.find((e) => e.path === "paths./confirm" && e.kind === "added");
        expect(added).toBeDefined();

        const removed = section.entries.find(
            (e) => e.path === "paths./select" && e.kind === "removed",
        );
        expect(removed).toBeDefined();
    });

    it("detects added/removed HTTP methods on existing path", () => {
        const oldC = makeConfig();
        const newC = makeConfig({
            paths: {
                "/search": {
                    post: { description: "Search" },
                    get: { description: "Get search results" }, // method added
                },
                "/select": { post: { description: "Select" } },
            },
        });
        const section = diffPaths(oldC, newC)!;
        expect(section).not.toBeNull();

        const addedMethod = section.entries.find(
            (e) => e.path === "paths./search.get" && e.kind === "added",
        );
        expect(addedMethod).toBeDefined();
    });
});

// ─── Truncation ──────────────────────────────────────────────────────────────

describe("truncation", () => {
    it("truncates entries beyond MAX_ENTRIES_PER_SECTION", () => {
        // Create a config with > 100 paths to trigger truncation
        const manyPaths: BuildConfig["paths"] = {};
        for (let i = 0; i < MAX_ENTRIES_PER_SECTION + 20; i++) {
            manyPaths[`/path-${i}`] = { post: { description: `Path ${i}` } };
        }

        const oldC = makeConfig({ paths: {} as BuildConfig["paths"] });
        const newC = makeConfig({ paths: manyPaths });
        const section = diffPaths(oldC, newC)!;

        expect(section).not.toBeNull();
        expect(section.truncated).toBe(true);
        expect(section.entries).toHaveLength(MAX_ENTRIES_PER_SECTION);
        expect(section.totalChanges).toBe(MAX_ENTRIES_PER_SECTION + 20);
        expect(section.truncatedCount).toBe(20);
    });
});
