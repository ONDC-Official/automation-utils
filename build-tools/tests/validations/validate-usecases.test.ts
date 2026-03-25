import { describe, it, expect } from "@jest/globals";
import { validateUsecaseIds } from "../../src/validations/validate-usecases.js";
import { makeConfig, makeFlowConfig } from "../fixtures.js";

describe("validateUsecaseIds", () => {
    it("passes when all usecases are declared", () => {
        const config = makeConfig();
        const result = validateUsecaseIds.run(config);
        expect(result.ok).toBe(true);
    });

    it("fails when a flow references an undeclared usecase", () => {
        const config = makeConfig({
            "x-flows": [
                {
                    type: "playground",
                    id: "flow-bad",
                    usecase: "uc-nonexistent",
                    tags: [],
                    description: "Bad flow",
                    config: makeFlowConfig("flow-bad"),
                },
            ],
        });

        const result = validateUsecaseIds.run(config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].message).toContain("uc-nonexistent");
            expect(result.issues[0].path).toContain("x-flows[0]");
        }
    });

    it("fails when an attribute references an undeclared usecase", () => {
        const config = makeConfig({
            "x-attributes": [
                {
                    meta: { use_case_id: "uc-nonexistent" },
                    attribute_set: {},
                },
            ],
        });

        const result = validateUsecaseIds.run(config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].message).toContain("uc-nonexistent");
            expect(result.issues[0].path).toContain("x-attributes[0]");
        }
    });

    it("collects multiple issues across flows and attributes", () => {
        const config = makeConfig({
            "x-flows": [
                {
                    type: "playground",
                    id: "flow-bad-1",
                    usecase: "uc-missing-1",
                    tags: [],
                    description: "Bad 1",
                    config: makeFlowConfig("flow-bad-1"),
                },
                {
                    type: "playground",
                    id: "flow-bad-2",
                    usecase: "uc-missing-2",
                    tags: [],
                    description: "Bad 2",
                    config: makeFlowConfig("flow-bad-2"),
                },
            ],
            "x-attributes": [
                {
                    meta: { use_case_id: "uc-missing-3" },
                    attribute_set: {},
                },
            ],
        });

        const result = validateUsecaseIds.run(config);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.issues).toHaveLength(3);
        }
    });

    it("passes when attribute has no meta.use_case_id", () => {
        const config = makeConfig({
            "x-attributes": [{ meta: {}, attribute_set: {} }],
        });

        const result = validateUsecaseIds.run(config);
        // Should pass — undefined use_case_id is allowed
        expect(result.ok).toBe(true);
    });
});
