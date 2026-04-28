export type FlowStepRef = {
    flowId: string;
    usecase: string;
    stepIndex: number;
    action: string;
    actionId: string;
    owner: string;
    responseFor: string | null;
    unsolicited: boolean;
    currentDescription: string;
    saveData: Record<string, string>;
    prevSaveDataKeys: string[];
};

export type FlowLevelRef = {
    flowId: string;
    usecase: string;
    tags: string[];
    currentDescription: string;
    stepCount: number;
    actionSummary: string[]; // e.g. ["search", "on_search", "select", ...]
};

export type FlowDraft = {
    description?: string;
};

export type FlowConfidenceScore = {
    score: number; // 0..1
    factors: Record<string, number>;
};

export type FlowReviewEntry =
    | {
          kind: "flow";
          flowId: string;
          usecase: string;
          tags: string[];
          approved: boolean;
          draft: FlowDraft;
          confidence?: FlowConfidenceScore;
          current: { description: string };
      }
    | {
          kind: "step";
          flowId: string;
          usecase: string;
          stepIndex: number;
          action: string;
          actionId: string;
          owner: string;
          approved: boolean;
          draft: FlowDraft;
          confidence?: FlowConfidenceScore;
          current: { description: string };
      };

export type FlowReviewFile = {
    _instructions: string;
    flowId: string;
    entries: FlowReviewEntry[];
};
