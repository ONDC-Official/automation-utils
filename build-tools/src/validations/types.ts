import type { BuildConfig } from "../types/build-type.js";

export type ValidationIssue = {
    /** Human-readable path or context (e.g. "flows[2].usecase") */
    path: string;
    message: string;
};

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

/**
 * A single pluggable validation check.
 * Add new ones to the pipeline array in pipeline.ts — no other file needs to change.
 */
export type ValidationCheck = {
    /** Short identifier shown in output, e.g. "usecase-ids" */
    name: string;
    /** Human-readable description shown before running */
    description: string;
    run: (config: BuildConfig) => ValidationResult;
};
