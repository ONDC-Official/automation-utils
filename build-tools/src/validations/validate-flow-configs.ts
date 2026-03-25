import { validateConfigForDeployment } from "@ondc/automation-mock-runner";
import type { BuildConfig } from "../types/build-type.js";
import type { ValidationCheck, ValidationIssue, ValidationResult } from "./types.js";

/**
 * Calls validateConfigForDeployment() (from @ondc/automation-mock-runner) for
 * every flow config in x-flows. Captures any thrown errors and surfaces them
 * as structured issues.
 */
export const validateFlowConfigs: ValidationCheck = {
    name: "flow-configs",
    description:
        "Each flow config in x-flows must pass validateConfigForDeployment() from automation-mock-runner",
    run(config: BuildConfig): ValidationResult {
        const issues: ValidationIssue[] = [];

        for (let i = 0; i < config["x-flows"].length; i++) {
            const flow = config["x-flows"][i];
            try {
                validateConfigForDeployment(flow.config);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                issues.push({
                    path: `x-flows[${i}] (id: "${flow.id}", usecase: "${flow.usecase}")`,
                    message,
                });
            }
        }

        return issues.length === 0 ? { ok: true } : { ok: false, issues };
    },
};
