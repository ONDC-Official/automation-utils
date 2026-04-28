export type EnumEntry = { code: string; description: string; reference: string };

export type TagEntry = {
    code: string;
    _description: LeafDraft;
    list?: Array<{ code: string; _description: LeafDraft }>;
};

export type LeafDraft = {
    required: boolean;
    usage: string;
    info: string;
    owner: string;
    type: string;
    enums?: EnumEntry[];
    tags?: TagEntry[];
};

export type LeafObservation = {
    ucId: string;
    action: string;
    path: string[];              // includes action as path[0]
    pathKey: string;             // dotted string without action: "message.intent.category.id"
    valueType: string;           // typeof of first observed value, or "object"|"array"
    sampleValues: unknown[];     // distinct observed values, capped
    sampleCounts?: Array<{ value: unknown; count: number }>; // counts per distinct value (uncapped)
    mostCommonValue?: unknown;   // value with the highest count
    isLeaf: boolean;             // primitive observed (not object)
    seenInFlows: string[];       // flow IDs
    isArrayIndexed: boolean;     // path crosses an array index
};

export type ReferenceHit = {
    flowId: string;
    actionId: string;
    kind: "generate" | "validate" | "requirements" | "comment" | "alias";
    snippet: string;
    matchedChain: string;
    role?: "read" | "write" | "delete";
    gatedBy?: string;
};

export type SessionReadHit = {
    sessionKey: string;
    snippet: string;
    /** Step that wrote this session key via saveData, if resolved. */
    originAction?: string;
    originPath?: string;
    originFlow?: string;
};

export type CrossFlowSignals = {
    setInGenerate: boolean;       // any generate ref anywhere
    assertedInValidate: boolean;  // any validate ref anywhere
    requiredInRequirements: boolean; // any requirements ref
    persistedKey?: string;        // saveData LHS key if attribute is persisted
    consumedAcrossSteps: boolean; // persistedKey appears as identifier in another step's source
};

export type SaveDataHit = {
    flowId: string;
    actionId: string;
    key: string;         // left-hand-side (session key)
    jsonpath: string;    // $.context.transaction_id
    /** True when the attribute is a descendant of an ancestor jsonpath that was persisted. */
    inherited?: boolean;
    /** When inherited, the ancestor jsonpath that was actually saved. */
    ancestorJsonpath?: string;
};

export type OpenApiMetadata = {
    description?: string;
    customDescription?: Record<string, unknown>; // the `_description` object from OpenAPI
    type?: string;
    enumValues?: string[];
};

export type ExistingLeafInfo = {
    /** Prior enums carried over from the existing x-attributes set. */
    enums?: EnumEntry[];
    /** Prior tag-structure carried over from the existing x-attributes set. */
    tags?: TagEntry[];
    /** Copy of the raw _description leaf, if any — useful for prompt context. */
    leaf?: Record<string, unknown>;
};

export type ContextBundle = {
    obs: LeafObservation;
    openapi: OpenApiMetadata | null;
    refs: ReferenceHit[];
    saveData: SaveDataHit[];
    sessionReads?: SessionReadHit[];
    existing: ExistingLeafInfo | null;
    crossFlow?: CrossFlowSignals;
};

export type BundleRef = {
    uc: string;
    action: string;
    index: number; // index inside bundlesByUc.get(uc).get(action)
    bundle: ContextBundle;
};

export type DedupGroup = {
    signature: string;
    refFingerprint: string;
    representative: ContextBundle;
    members: BundleRef[];
};

export type ConfidenceScore = {
    score: number; // 0..1
    factors: Record<string, number>;
};

export type ReviewEntry = {
    path: string;
    approved: boolean;
    draft: LeafDraft;
    confidence?: ConfidenceScore;
    context_preview: {
        sample_values: unknown[];
        referenced_in: Array<{ flow: string; action_id: string; kind: string; snippet: string }>;
        save_data: Array<{ flow: string; key: string; jsonpath: string }>;
        openapi_info: string | null;
    };
};

export type ReviewFile = {
    _instructions: string;
    usecase: string;
    action: string;
    attributes: ReviewEntry[];
};
