export interface OpenAPIInfo {
    title: string;
    description: string;
    version: string;
    domain?: string;
}

export interface OpenAPISecurityScheme {
    type: string;
    in?: string;
    name?: string;
    description?: string;
}

export interface OpenAPISecurity {
    [key: string]: unknown[];
}

export interface OpenAPISchema {
    type?: string;
    description?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    enum?: unknown[];
    allOf?: unknown[];
    additionalProperties?: boolean | Record<string, unknown>;
    $ref?: string;
    [key: string]: unknown;
}

export interface OpenAPIRequestBody {
    content?: {
        [mediaType: string]: {
            schema?: OpenAPISchema;
        };
    };
}

export interface OpenAPIResponse {
    description?: string;
    content?: {
        [mediaType: string]: {
            schema?: OpenAPISchema;
        };
    };
    $ref?: string;
}

export interface OpenAPIPathItem {
    [method: string]: {
        tags?: string[];
        description?: string;
        requestBody?: OpenAPIRequestBody;
        responses?: {
            [statusCode: string]: OpenAPIResponse;
        };
        [key: string]: unknown;
    };
}

export interface OpenAPIComponents {
    securitySchemes?: {
        [key: string]: OpenAPISecurityScheme;
    };
    schemas?: {
        [key: string]: OpenAPISchema;
    };
    [key: string]: unknown;
}

export interface MockExample {
    name?: string;
    description?: string;
    type?: string;
    payload?: unknown;
}

export interface FlowStep {
    summary?: string;
    api: string;
    action_id?: string;
    action_label?: string;
    responseFor?: string | null;
    unsolicited?: boolean;
    owner?: string;
    description?: string;
    details?: Array<{
        description?: string;
    }>;
    reference?: string;
    example?: {
        summary?: string;
        value?: unknown;
    };
    /** Examples at step level (preferred); also supported under mock.examples for backward compatibility */
    examples?: MockExample[];
    mock?: {
        examples?: MockExample[];
        /** Base64-encoded generate function for this step */
        generate?: string;
        /** Base64-encoded validate function for this step */
        validate?: string;
        /** Base64-encoded requirements for this step */
        requirements?: string;
        [key: string]: unknown;
    };
}

export interface Flow {
    summary?: string;
    meta?: {
        use_case_id?: string;
        domain?: string;
        flowId?: string;
        flowName?: string;
        description?: string;
        [key: string]: unknown;
    };
    details?: Array<{
        description?: string;
    }>;
    reference?: string;
    steps: FlowStep[];
    /** Use case for x-attributes lookup; also read from meta.use_case_id when present */
    useCaseId?: string;
    /** Base64-encoded helper JS library for mock generation */
    helperLib?: string;
}

export interface XValidationRule {
    _NAME_?: string;
    attr?: string;
    _RETURN_?: string | XValidationRule[];
    reg?: string[];
    valid?: string[];
    domain?: string[];
    version?: string[];
    action?: string[];
    search?: string[];
    _CONTINUE_?: string;
    optional_vars?: string[];
    [key: string]: unknown;
}

export interface XValidationTestGroup {
    _NAME_?: string;
    _DESCRIPTION_?: string;
    action?: string[];
    _RETURN_?: XValidationRule[];
    [key: string]: unknown;
}

export interface EnumEntry {
    code: string;
    description: string;
    reference: string;
}

export interface NewAttributeLeaf {
    required: boolean;
    usage: string;
    info: string;
    owner: string;
    type: string;
    enums?: EnumEntry[];
    enumrefs?: Array<{ label: string; href: string }>;
    tags?: Array<{
        code: string;
        _description: NewAttributeLeaf;
        list?: Array<{
            code: string;
            _description: NewAttributeLeaf;
        }>;
    }>;
}
export type NewAttributeValue =
    | NewAttributeLeaf
    | { [key: string]: NewAttributeValue | undefined };

export interface NewAttributes {
    meta?: { use_case_id?: string; [key: string]: unknown };
    attribute_set?: { [action: string]: NewAttributeValue | undefined };
}

export interface NewBuildType {
    openapi: string;
    info: OpenAPIInfo;
    security?: OpenAPISecurity[];
    paths?: {
        [path: string]: OpenAPIPathItem;
    };
    components?: OpenAPIComponents;
    "x-flows"?: Flow[];
    "x-attributes"?: NewAttributes[];
    "x-validations"?: Record<
        string,
        Record<string, XValidationTestGroup[]> | Record<string, unknown>
    >;
    "x-errorcodes"?: {
        code: {
            Event: string;
            Description: string;
            From: string;
            code: string;
        }[];
    };
}
