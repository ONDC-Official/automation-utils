import type { BuildConfig } from "../types/build-type.js";
import type { ValidationCheck, ValidationResult } from "./types.js";
import { validateUsecaseIds } from "./validate-usecases.js";
import { validateFlowConfigs } from "./validate-flow-configs.js";

/**
 * Ordered list of validation checks.
 *
 * To add a new check:  import it and push it onto this array.
 * To disable a check: remove or comment it out here — nothing else changes.
 */
export const VALIDATION_PIPELINE: ValidationCheck[] = [validateUsecaseIds, validateFlowConfigs];

export type PipelineReport = {
    passed: string[];
    failed: { name: string; description: string; issues: { path: string; message: string }[] }[];
};

/**
 * Runs every check in VALIDATION_PIPELINE against the resolved BuildConfig.
 * Returns a structured report — the caller decides how to display or exit.
 */
export function runValidationPipeline(config: BuildConfig): PipelineReport {
    const report: PipelineReport = { passed: [], failed: [] };

    for (const check of VALIDATION_PIPELINE) {
        const result: ValidationResult = check.run(config);
        if (result.ok) {
            report.passed.push(check.name);
        } else {
            report.failed.push({
                name: check.name,
                description: check.description,
                issues: result.issues,
            });
        }
    }

    return report;
}
