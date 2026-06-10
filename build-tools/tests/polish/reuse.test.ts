import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    MAX_REUSE_MATCHES,
    loadReuseIndex,
    lookupReuse,
    resolveReviewDir,
    reuseKey,
} from "../../src/polish/attributes/reuse.js";
import {
    buildPrompt,
    draftLeaves,
    itemToLLMInput,
    type DraftItem,
} from "../../src/polish/attributes/draft.js";
import type { ContextBundle } from "../../src/polish/attributes/types.js";
import type { ILLMProvider, LLMMessage } from "../../src/knowledge-book/llm/types.js";

type Entry = { path: string; approved: boolean; info: string };

function reviewFile(usecase: string, action: string, entries: Entry[]): unknown {
    return {
        _instructions: "test",
        usecase,
        action,
        attributes: entries.map((e) => ({
            path: e.path,
            approved: e.approved,
            draft: { required: false, usage: "", info: e.info, owner: "BAP", type: "string" },
            context_preview: { sample_values: [], referenced_in: [], save_data: [], openapi_info: null },
        })),
    };
}

function writeReview(dir: string, slug: string, content: unknown): void {
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify(content), "utf-8");
}

function makeBundle(pathKey: string): ContextBundle {
    return {
        obs: {
            ucId: "UC",
            action: "confirm",
            path: ["confirm", ...pathKey.split(".")],
            pathKey,
            valueType: "string",
            sampleValues: ["v1"],
            isLeaf: true,
            seenInFlows: ["flow-1"],
            isArrayIndexed: false,
        },
        openapi: null,
        refs: [],
        saveData: [],
        existing: null,
    };
}

let root: string;
let reviewDir: string;

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "reuse-test-"));
    // Layout: <root>/external/.polish/attributes-review/*.json
    reviewDir = join(root, "external", ".polish", "attributes-review");
    mkdirSync(reviewDir, { recursive: true });

    writeReview(
        reviewDir,
        "GOLD_LOAN__confirm",
        reviewFile("GOLD LOAN", "confirm", [
            { path: "context.transaction_id", approved: true, info: "Gold txn id." },
            { path: "context.notapproved", approved: false, info: "Not approved." },
            { path: "context.fb", approved: true, info: "AUTO-FALLBACK (boom). edit me" },
            { path: "context.sent", approved: true, info: "<no-enough-data>" },
            { path: "context.empty", approved: true, info: "   " },
        ]),
    );
    writeReview(
        reviewDir,
        "PERSONAL_LOAN__confirm",
        reviewFile("PERSONAL LOAN", "confirm", [
            { path: "context.transaction_id", approved: true, info: "Personal txn id." },
        ]),
    );

    // Cap test: 4 distinct usecases, same (action,path) → only MAX_REUSE_MATCHES kept.
    for (const uc of ["A", "B", "C", "D"]) {
        writeReview(
            reviewDir,
            `${uc}__search`,
            reviewFile(uc, "search", [{ path: "cap.path", approved: true, info: `${uc} info.` }]),
        );
    }

    // Identical-info dedup: distinct usecases but same text → collapses to 1.
    writeReview(
        reviewDir,
        "E__status",
        reviewFile("E", "status", [{ path: "dup.path", approved: true, info: "Same text." }]),
    );
    writeReview(
        reviewDir,
        "F__status",
        reviewFile("F", "status", [{ path: "dup.path", approved: true, info: "Same text." }]),
    );

    // Malformed file → warned + skipped, never throws.
    writeFileSync(join(reviewDir, "bad__x.json"), "{not valid json", "utf-8");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("resolveReviewDir", () => {
    it("resolves a polished output folder (via .polish/attributes-review)", () => {
        expect(resolveReviewDir(join(root, "external"))).toBe(reviewDir);
    });

    it("resolves the attributes-review dir passed directly", () => {
        expect(resolveReviewDir(reviewDir)).toBe(reviewDir);
    });

    it("resolves <path>/attributes-review without a .polish parent", () => {
        const flat = join(root, "flat");
        const flatReview = join(flat, "attributes-review");
        mkdirSync(flatReview, { recursive: true });
        expect(resolveReviewDir(flat)).toBe(flatReview);
    });

    it("returns null when nothing resolves", () => {
        expect(resolveReviewDir(join(root, "does-not-exist"))).toBeNull();
    });
});

describe("loadReuseIndex", () => {
    it("indexes only approved, non-fallback, non-sentinel, non-empty entries", () => {
        const { index } = loadReuseIndex([join(root, "external")]);
        const matches = lookupReuse(index, "confirm", "context.transaction_id");
        // Gold + Personal both approved → 2 distinct matches.
        expect(matches.map((m) => m.info).sort()).toEqual(["Gold txn id.", "Personal txn id."]);
        // Excluded entries never produce keys.
        expect(lookupReuse(index, "confirm", "context.notapproved")).toEqual([]);
        expect(lookupReuse(index, "confirm", "context.fb")).toEqual([]);
        expect(lookupReuse(index, "confirm", "context.sent")).toEqual([]);
        expect(lookupReuse(index, "confirm", "context.empty")).toEqual([]);
    });

    it("caps matches per key at MAX_REUSE_MATCHES", () => {
        const { index } = loadReuseIndex([reviewDir]);
        const matches = lookupReuse(index, "search", "cap.path");
        expect(matches.length).toBe(MAX_REUSE_MATCHES);
    });

    it("dedups identical info text across usecases", () => {
        const { index } = loadReuseIndex([reviewDir]);
        const matches = lookupReuse(index, "status", "dup.path");
        expect(matches.length).toBe(1);
        expect(matches[0]!.info).toBe("Same text.");
    });

    it("warns and skips malformed JSON without throwing", () => {
        const { warnings } = loadReuseIndex([reviewDir]);
        expect(warnings.some((w) => w.includes("bad__x.json"))).toBe(true);
    });

    it("warns on an unresolvable path", () => {
        const { index, warnings } = loadReuseIndex([join(root, "nope")]);
        expect(index.stats.keys).toBe(0);
        expect(warnings.some((w) => w.includes("nope"))).toBe(true);
    });
});

describe("lookupReuse", () => {
    it("returns [] for an undefined index", () => {
        expect(lookupReuse(undefined, "confirm", "context")).toEqual([]);
    });

    it("keys by action::pathKey", () => {
        expect(reuseKey("confirm", "context.x")).toBe("confirm::context.x");
    });
});

describe("draft reuse integration", () => {
    const reuse = [
        { info: "Reviewed verbatim text.", usecase: "GOLD LOAN", action: "confirm", path: "context", sourceFile: "x" },
    ];

    function fakeLLM(onComplete: () => void, reply = "LLM-generated text."): ILLMProvider {
        return {
            async ping(): Promise<void> {},
            async complete(_msgs: LLMMessage[]): Promise<string> {
                onComplete();
                return reply;
            },
        };
    }

    it("verbatim mode adopts the first match and never calls the LLM", async () => {
        let called = false;
        const item: DraftItem = { action: "confirm", bundle: makeBundle("context"), reuse };
        const [draft] = await draftLeaves(fakeLLM(() => (called = true)), [item], undefined, {
            reuseVerbatim: true,
        });
        expect(called).toBe(false);
        expect(draft!.info).toBe("Reviewed verbatim text.");
    });

    it("enrich mode calls the LLM and injects prior_reviewed into the prompt", async () => {
        let called = false;
        const item: DraftItem = { action: "confirm", bundle: makeBundle("context"), reuse };
        const [draft] = await draftLeaves(fakeLLM(() => (called = true)), [item], undefined, {
            reuseVerbatim: false,
        });
        expect(called).toBe(true);
        expect(draft!.info).toBe("LLM-generated text.");

        const input = itemToLLMInput(item);
        expect(input.prior_reviewed).toEqual([{ info: "Reviewed verbatim text." }]);
        const prompt = buildPrompt([input], "");
        expect(prompt).toContain("prior_reviewed");
        expect(prompt).toContain("Reviewed verbatim text.");
    });

    it("verbatim mode falls back to the LLM when there is no match", async () => {
        let called = false;
        const item: DraftItem = { action: "confirm", bundle: makeBundle("context") };
        const [draft] = await draftLeaves(fakeLLM(() => (called = true)), [item], undefined, {
            reuseVerbatim: true,
        });
        expect(called).toBe(true);
        expect(draft!.info).toBe("LLM-generated text.");
    });
});
