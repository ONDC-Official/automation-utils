/**
 * Library entry point for `@ondc/build-tools`.
 *
 * Use this import path when consuming the package as a library (e.g., from a
 * DB service). The CLI entry point (`src/index.ts`) is separate and should
 * only be used via the `ondc-tools` binary.
 *
 * ```ts
 * import { BuildConfig } from "@ondc/build-tools";
 * import { ingestBuild, createIndexes } from "@ondc/build-tools/store";
 * ```
 */

// ─── Types & schemas ─────────────────────────────────────────────────────────

export { BuildConfig } from "./types/build-type.js";
export type {
    Flow,
    FlowEntry,
    FlowsIndex,
    AttributeSet,
    Validations,
    ErrorCodes,
    SupportedActions,
} from "./types/build-type.js";

// ─── Change log types ────────────────────────────────────────────────────────

export type { ChangeKind, ChangeEntry, ChangeSection, ChangeLog } from "./change-logs/types.js";

// ─── Diff functions ──────────────────────────────────────────────────────────

export {
    MAX_ENTRIES_PER_SECTION,
    diffInfo,
    diffFlows,
    diffAttributes,
    diffErrors,
    diffActions,
    diffPaths,
} from "./change-logs/diff.js";

// ─── Validation types ────────────────────────────────────────────────────────

export type { ValidationIssue, ValidationResult, ValidationCheck } from "./validations/types.js";

export * from "./store/index.js";
