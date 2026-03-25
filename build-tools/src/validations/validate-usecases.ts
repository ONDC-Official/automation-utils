import type { BuildConfig } from "../types/build-type.js";
import type { ValidationCheck, ValidationIssue, ValidationResult } from "./types.js";

/**
 * Checks that every usecase ID referenced anywhere in the build config
 * (x-flows[].usecase and x-attributes[].meta.use_case_id) is declared
 * in info["x-usecases"].
 */
export const validateUsecaseIds: ValidationCheck = {
    name: "usecase-ids",
    description: "All usecase IDs in x-flows and x-attributes must be declared in info.x-usecases",
    run(config: BuildConfig): ValidationResult {
        const declared = new Set(config.info["x-usecases"]);
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < config["x-flows"].length; i++) {
            const flow = config["x-flows"][i];
            if (!declared.has(flow.usecase)) {
                issues.push({
                    path: `x-flows[${i}] (id: "${flow.id}")`,
                    message: `usecase "${flow.usecase}" is not listed in info.x-usecases`,
                });
            }
        }

        for (let i = 0; i < config["x-attributes"].length; i++) {
            const id = config["x-attributes"][i].meta?.use_case_id;
            if (id !== undefined && !declared.has(id)) {
                issues.push({
                    path: `x-attributes[${i}].meta.use_case_id`,
                    message: `use_case_id "${id}" is not listed in info.x-usecases`,
                });
            }
        }

        return issues.length === 0 ? { ok: true } : { ok: false, issues };
    },
};
