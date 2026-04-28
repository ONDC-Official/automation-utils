import type { PolishStep } from "./types.js";
import { scaffoldStep } from "./steps/scaffold.js";
import { overviewDetectStep } from "./steps/overview-detect.js";
import { overviewQuestionsStep } from "./steps/overview-questions.js";
import { overviewComposeStep } from "./steps/overview-compose.js";
import { overviewWriteStep } from "./steps/overview-write.js";
import { attributesDetectStep } from "./steps/attributes-detect.js";
import { attributesMineStep } from "./steps/attributes-mine.js";
import { attributesDedupStep } from "./steps/attributes-dedup.js";
import { attributesPreviewPromptsStep } from "./steps/attributes-preview-prompts.js";
import { attributesDraftStep } from "./steps/attributes-draft.js";
import { attributesReviewStep } from "./steps/attributes-review.js";
import { attributesWriteStep } from "./steps/attributes-write.js";
import { flowsDetectStep } from "./steps/flows-detect.js";
import { flowsDraftStep } from "./steps/flows-draft.js";
import { flowsReviewStep } from "./steps/flows-review.js";
import { flowsWriteStep } from "./steps/flows-write.js";

/**
 * Ordered list of polish steps.
 *
 * Steps share data via ctx.state. Later steps read what earlier steps wrote
 * (e.g. overview-detect sets state.overviewGap; downstream steps skip if false).
 *
 * To add a new step: create src/polish/steps/<name>.ts exporting a PolishStep,
 * import here, append to array.
 */
export const POLISH_PIPELINE: PolishStep[] = [
    scaffoldStep,
    overviewDetectStep,
    overviewQuestionsStep,
    overviewComposeStep,
    overviewWriteStep,
    attributesDetectStep,
    attributesMineStep,
    attributesDedupStep,
    attributesPreviewPromptsStep,
    // attributesDraftStep,
    // attributesReviewStep,
    // attributesWriteStep,
    // flowsDetectStep,
    // flowsDraftStep,
    // flowsReviewStep,
    // flowsWriteStep,
];
