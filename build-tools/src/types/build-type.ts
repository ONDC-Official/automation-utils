import { z } from "zod";
import { MockPlaygroundConfigSchema } from "@ondc/automation-mock-runner";

// ─── OpenAPI 3.0 ──────────────────────────────────────────────────────────────

const OpenAPISchemaZ: z.ZodType<unknown> = z.lazy(() =>
    z.looseObject({
        type: z.string().optional(),
        description: z.string().optional(),
        properties: z.record(z.string(), OpenAPISchemaZ).optional(),
        required: z.array(z.string()).optional(),
        enum: z.array(z.unknown()).optional(),
        allOf: z.array(OpenAPISchemaZ).optional(),
        oneOf: z.array(OpenAPISchemaZ).optional(),
        anyOf: z.array(OpenAPISchemaZ).optional(),
        items: OpenAPISchemaZ.optional(),
        additionalProperties: z.union([z.boolean(), OpenAPISchemaZ]).optional(),
        $ref: z.string().optional(),
    }),
);

const OpenAPIOperationZ = z.looseObject({
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    requestBody: z
        .looseObject({
            content: z
                .record(z.string(), z.looseObject({ schema: OpenAPISchemaZ.optional() }))
                .optional(),
        })
        .optional(),
    responses: z
        .record(
            z.string(),
            z.union([
                z.object({ $ref: z.string() }),
                z.looseObject({
                    description: z.string().optional(),
                    content: z
                        .record(
                            z.string(),
                            z.looseObject({
                                schema: OpenAPISchemaZ.optional(),
                            }),
                        )
                        .optional(),
                }),
            ]),
        )
        .optional(),
});

const OpenAPIPathsZ = z.record(z.string(), z.record(z.string(), OpenAPIOperationZ));

const OpenAPIComponentsZ = z.looseObject({
    securitySchemes: z
        .record(
            z.string(),
            z.looseObject({
                type: z.string(),
                in: z.string().optional(),
                name: z.string().optional(),
                description: z.string().optional(),
            }),
        )
        .optional(),
    schemas: z.record(z.string(), OpenAPISchemaZ).optional(),
});

// ─── Flows ────────────────────────────────────────────────────────────────────

const FlowZ = MockPlaygroundConfigSchema;

// flows/index.yaml — flat manifest of all flows across all usecases
const FlowEntryZ = z.object({
    type: z.literal("playground"),
    id: z.string(),
    usecase: z.string(),
    tags: z.array(z.string()),
    description: z.string(),
    config: FlowZ,
});

const FlowsIndexZ = z.object({
    flows: z.array(FlowEntryZ),
});

// ─── Attributes ───────────────────────────────────────────────────────────────

const EnumEntryZ = z.object({
    code: z.string(),
    description: z.string(),
    reference: z.string(),
});

// AttributeLeafZ references AttributeTagEntryZ which references AttributeLeafZ — use z.lazy
interface AttributeLeaf {
    required: boolean;
    usage: string;
    info: string;
    owner: string;
    type: string;
    enums?: { code: string; description: string; reference: string }[];
    enumrefs?: { label: string; href: string }[];
    tags?: AttributeTagEntry[];
}

interface AttributeTagEntry {
    code: string;
    _description: AttributeLeaf;
    list?: { code: string; _description: AttributeLeaf }[];
}

const AttributeLeafZ: z.ZodType<AttributeLeaf> = z.lazy(() =>
    z.object({
        required: z.boolean(),
        usage: z.coerce.string().catch("-"),
        info: z.coerce.string().catch("no information provided"),
        owner: z.coerce.string().catch("unknown"),
        type: z.coerce.string().catch("unknown"),
        enums: z.array(EnumEntryZ).optional(),
        enumrefs: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
        tags: z.array(AttributeTagEntryZ).optional(),
    }),
);

const AttributeTagEntryZ: z.ZodType<AttributeTagEntry> = z.lazy(() =>
    z.object({
        code: z.string(),
        _description: AttributeLeafZ,
        list: z
            .array(
                z.object({
                    code: z.string(),
                    _description: AttributeLeafZ,
                }),
            )
            .optional(),
    }),
);

const AttributeValueZ: z.ZodType<unknown> = z.lazy(() =>
    z
        .custom<unknown>((val) => typeof val === "object" && val !== null, {
            message: "Expected object",
        })
        .superRefine((val, ctx) => {
            const isLeaf = "required" in (val as any);
            const result = isLeaf ? AttributeLeafZ.safeParse(val) : AttributeNodeZ.safeParse(val);

            if (!result.success) {
                for (const issue of result.error.issues) {
                    ctx.addIssue({
                        ...issue,
                        path: [...(issue.path ?? [])],
                    });
                }
            }
        }),
);

export const AttributeNodeZ: z.ZodType<unknown> = z.lazy(() =>
    z.record(z.string(), AttributeValueZ),
);

const AttributeSetZ = z.object({
    meta: z.looseObject({ use_case_id: z.string().optional() }).optional(),
    attribute_set: z.record(z.string(), AttributeNodeZ).optional(),
});

// ─── Error Codes ──────────────────────────────────────────────────────────────

const ErrorCodesZ = z.object({
    code: z.array(
        z.object({
            Event: z.string().default("no event specified"),
            Description: z.string().default("no description provided"),
            From: z.string().default("no source specified"),
            code: z.union([z.string(), z.number()]).default("-1"),
        }),
    ),
});

// ─── Supported Actions ────────────────────────────────────────────────────────

const SupportedActionsZ = z.object({
    supportedActions: z.record(z.string(), z.array(z.string())),
    apiProperties: z.record(
        z.string(),
        z.object({
            async_predecessor: z.string().nullable(),
            transaction_partner: z.array(z.string()),
        }),
    ),
});

// ─── Root BuildConfig ─────────────────────────────────────────────────────────

export const BuildConfig = z.object({
    openapi: z.string().regex(/^3\.\d+\.\d+$/),
    info: z.object({
        title: z.string().optional(),
        domain: z.string(),
        description: z.string().optional(),
        version: z.string(),
        "x-usecases": z.array(z.string()),
        "x-branch-name": z.string().optional(),
        "x-reporting": z.boolean(),
    }),
    security: z.any(),
    paths: z.any(),
    components: z.any(),
    "x-attributes": z.array(AttributeSetZ),
    "x-validations": z.unknown(),
    "x-errors-codes": ErrorCodesZ,
    "x-supported-actions": SupportedActionsZ,
    // x-flows resolves via $ref: ./flows/index.yaml#/flows — the array directly
    "x-flows": z.array(FlowEntryZ),
    // x-docs resolves via $ref: ./docs — the directory is resolved to an object
    // keyed by file stem (e.g. "overview", "release-notes", "references") with
    // markdown string values. Additional doc files may be added freely.
    "x-docs": z.record(z.string(), z.string()).optional(),
});

export type BuildConfig = z.infer<typeof BuildConfig>;

// Named sub-type exports for use elsewhere
export type Flow = z.infer<typeof FlowZ>;
export type FlowEntry = z.infer<typeof FlowEntryZ>;
export type FlowsIndex = z.infer<typeof FlowsIndexZ>;
export type AttributeSet = z.infer<typeof AttributeSetZ>;
export type Validations = z.infer<(typeof BuildConfig.shape)["x-validations"]>;
export type ErrorCodes = z.infer<typeof ErrorCodesZ>;
export type SupportedActions = z.infer<typeof SupportedActionsZ>;
