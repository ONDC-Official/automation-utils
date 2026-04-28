import type { ReviewFile } from "../attributes/types.js";
import type { FlowReviewFile } from "../flows/types.js";

export type AttributesReviewSession = {
    kind: "attributes";
    threshold: number;
    files: ReviewFile[];
};

export type FlowsReviewSession = {
    kind: "flows";
    threshold: number;
    files: FlowReviewFile[];
};

export type ReviewSession = AttributesReviewSession | FlowsReviewSession;
