import {
    EnumEntry,
    OpenAPIComponents,
    OpenAPIInfo,
    OpenAPIPathItem,
    OpenAPISecurity,
    XValidationTestGroup,
} from "./new-build.js";

export type OldEnumEntry = EnumEntry;
export type OldEnumValue = OldEnumEntry[] | { [key: string]: OldEnumValue };

export interface OldEnums {
    [action: string]: OldEnumValue | undefined;
}

export interface OldTagEntry {
    code: string;
    description: string;
    reference: string;
    list?: Omit<OldTagEntry, "list">[];
}

export type OldTagValue = OldTagEntry[] | { [key: string]: OldTagValue };

export interface OldTags {
    [action: string]: OldTagValue | undefined;
}

export interface OldAttributeEntry {
    required: string;
    type: string;
    owner: string;
    usage: string;
    description: string;
    list?: { [key: string]: Omit<OldAttributeEntry, "list"> };
}

export type OldAttributeValue =
    | OldAttributeEntry
    | { [key: string]: OldAttributeValue };

export interface OldAttributes {
    [useCase: string]:
        | {
              attribute_set?: {
                  [action: string]: OldAttributeValue | undefined;
              };
          }
        | undefined;
}
export type OldFlow = {
    summary: string;
    description?: string;
    details: {
        description?: string;
        mermaidGraph?: string;
    }[];
    steps: {
        summary: string;
        api: string;
    }[];
};

export type OldFlows = OldFlow[];

export interface OldBuildType {
    openapi: string;
    info: OpenAPIInfo;
    security?: OpenAPISecurity[];
    paths?: {
        [path: string]: OpenAPIPathItem;
    };
    components?: OpenAPIComponents;
    "x-errorcodes"?: {
        code: {
            Event: string;
            Description: string;
            From: string;
            code: string;
        }[];
    };
    "x-validations"?: Record<
        string,
        Record<string, XValidationTestGroup[]> | Record<string, unknown>
    >;
    "x-enum"?: OldEnums;
    "x-tags"?: OldTags;
    "x-attributes"?: OldAttributes;
    "x-flows"?: OldFlows;
}
