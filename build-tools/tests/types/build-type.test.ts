import { describe, it, expect } from "@jest/globals";
import { BuildConfig } from "../../src/types/build-type.js";
import { makeConfig } from "../fixtures.js";

describe("BuildConfig schema", () => {
    it("accepts a valid config", () => {
        const config = makeConfig();
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(true);
    });

    it("rejects missing openapi field", () => {
        const config = makeConfig();
        const { openapi, ...rest } = config;
        const result = BuildConfig.safeParse(rest);
        expect(result.success).toBe(false);
    });

    it("rejects invalid openapi version format", () => {
        const config = makeConfig({ openapi: "2.0" });
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(false);
    });

    it("accepts openapi 3.x.x versions", () => {
        for (const version of ["3.0.0", "3.1.0", "3.0.3"]) {
            const config = makeConfig({ openapi: version });
            const result = BuildConfig.safeParse(config);
            expect(result.success).toBe(true);
        }
    });

    it("rejects missing info.domain", () => {
        const config = makeConfig();
        const badConfig = {
            ...config,
            info: { ...config.info, domain: undefined },
        };
        const result = BuildConfig.safeParse(badConfig);
        expect(result.success).toBe(false);
    });

    it("rejects missing info.version", () => {
        const config = makeConfig();
        const badConfig = {
            ...config,
            info: { ...config.info, version: undefined },
        };
        const result = BuildConfig.safeParse(badConfig);
        expect(result.success).toBe(false);
    });

    it("rejects missing x-usecases", () => {
        const config = makeConfig();
        const badConfig = {
            ...config,
            info: { ...config.info, "x-usecases": undefined },
        };
        const result = BuildConfig.safeParse(badConfig);
        expect(result.success).toBe(false);
    });

    it("accepts optional x-docs as undefined", () => {
        const config = makeConfig({ "x-docs": undefined });
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(true);
    });

    it("accepts x-validations as any shape (unknown)", () => {
        const config = makeConfig({ "x-validations": { anything: [1, 2, 3] } });
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(true);
    });

    it("rejects x-flows with missing id", () => {
        const config = makeConfig({
            "x-flows": [
                {
                    type: "playground",
                    // id missing
                    usecase: "uc-alpha",
                    tags: [],
                    description: "test",
                    config: {},
                } as any,
            ],
        });
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(false);
    });

    it("rejects empty x-errors-codes.code when code array expected", () => {
        const config = makeConfig({
            "x-errors-codes": { code: "not-an-array" } as any,
        });
        const result = BuildConfig.safeParse(config);
        expect(result.success).toBe(false);
    });

    it("infers correct TypeScript type (smoke test)", () => {
        const config = makeConfig();
        const parsed = BuildConfig.parse(config);

        // These accesses should work without type errors at compile time
        const domain: string = parsed.info.domain;
        const version: string = parsed.info.version;
        const usecases: string[] = parsed.info["x-usecases"];
        const flows = parsed["x-flows"];

        expect(domain).toBe("ONDC:TEST01");
        expect(version).toBe("1.0.0");
        expect(usecases).toHaveLength(2);
        expect(flows).toHaveLength(2);
    });
});
