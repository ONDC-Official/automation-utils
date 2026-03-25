import { describe, it, expect } from "@jest/globals";
import { runValidationPipeline, VALIDATION_PIPELINE } from "../../src/validations/pipeline.js";
import { makeConfig, makeFlowConfig } from "../fixtures.js";

describe("VALIDATION_PIPELINE", () => {
    it("contains at least 2 checks", () => {
        expect(VALIDATION_PIPELINE.length).toBeGreaterThanOrEqual(2);
    });

    it("each check has name, description, and run function", () => {
        for (const check of VALIDATION_PIPELINE) {
            expect(typeof check.name).toBe("string");
            expect(check.name.length).toBeGreaterThan(0);
            expect(typeof check.description).toBe("string");
            expect(typeof check.run).toBe("function");
        }
    });
});

describe("runValidationPipeline", () => {
    it("returns all passed when config is valid", () => {
        const config = makeConfig();
        const report = runValidationPipeline(config);

        expect(report.passed).toContain("usecase-ids");
        expect(report.failed).toHaveLength(0);
    });

    it("returns failed checks with issues for invalid config", () => {
        const config = makeConfig({
            "x-flows": [
                {
                    type: "playground",
                    id: "flow-bad",
                    usecase: "uc-nonexistent",
                    tags: [],
                    description: "Bad",
                    config: makeFlowConfig("flow-bad"),
                },
            ],
        });

        const report = runValidationPipeline(config);
        const usecaseFail = report.failed.find((f) => f.name === "usecase-ids");
        expect(usecaseFail).toBeDefined();
        expect(usecaseFail!.issues.length).toBeGreaterThan(0);
    });

    it("report structure has passed and failed arrays", () => {
        const config = makeConfig();
        const report = runValidationPipeline(config);

        expect(Array.isArray(report.passed)).toBe(true);
        expect(Array.isArray(report.failed)).toBe(true);
    });
});
