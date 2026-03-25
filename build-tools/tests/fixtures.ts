/**
 * Shared test fixtures — factory functions for building valid `BuildConfig`
 * objects with sensible defaults. Override any field via the `overrides` param.
 */

import type { BuildConfig } from "../src/types/build-type.js";

// ─── Minimal valid flow config (satisfies MockPlaygroundConfigSchema) ────────

export function makeFlowConfig(flowId: string) {
    return {
        meta: { domain: "ONDC:TEST01", version: "1.0.0", flowId },
        transaction_data: { transaction_id: "tx-1", latest_timestamp: "2026-01-01T00:00:00Z" },
        transaction_history: [],
        validationLib: "lib",
        helperLib: "helper",
        steps: [],
    };
}

// ─── Minimal valid BuildConfig ───────────────────────────────────────────────

const DEFAULT_CONFIG: BuildConfig = {
    openapi: "3.0.0",
    info: {
        title: "Test Domain",
        domain: "ONDC:TEST01",
        description: "A test build config",
        version: "1.0.0",
        "x-usecases": ["uc-alpha", "uc-beta"],
        "x-branch-name": "main",
        "x-reporting": false,
    },
    paths: {
        "/search": {
            post: {
                description: "Search for items",
            },
        },
        "/select": {
            post: {
                description: "Select an item",
            },
        },
    },
    components: {
        schemas: {
            Item: { type: "object", properties: { id: { type: "string" } } },
        },
    },
    "x-flows": [
        {
            type: "playground",
            id: "flow-1",
            usecase: "uc-alpha",
            tags: ["happy-path", "search"],
            description: "Basic search flow",
            config: makeFlowConfig("flow-1"),
        },
        {
            type: "playground",
            id: "flow-2",
            usecase: "uc-beta",
            tags: ["select"],
            description: "Basic select flow",
            config: makeFlowConfig("flow-2"),
        },
    ],
    "x-attributes": [
        {
            meta: { use_case_id: "uc-alpha" },
            attribute_set: {
                search: {
                    message: {
                        intent: {
                            _description: {
                                required: true,
                                usage: "mandatory",
                                info: "Search intent",
                                owner: "BAP",
                                type: "object",
                            },
                        },
                    },
                },
            },
        },
        {
            meta: { use_case_id: "uc-beta" },
            attribute_set: {
                select: {
                    message: {
                        order: {
                            _description: {
                                required: true,
                                usage: "mandatory",
                                info: "Order object",
                                owner: "BAP",
                                type: "object",
                            },
                        },
                    },
                },
            },
        },
    ],
    "x-validations": { rules: ["rule-1", "rule-2"] },
    "x-errors-codes": {
        code: [
            { Event: "SEARCH_ERR", Description: "Search failed", From: "BAP", code: "40001" },
            { Event: "SELECT_ERR", Description: "Select failed", From: "BPP", code: "40002" },
        ],
    },
    "x-supported-actions": {
        supportedActions: {
            search: ["on_search"],
            select: ["on_select"],
        },
        apiProperties: {
            search: { async_predecessor: null, transaction_partner: ["BPP"] },
            select: { async_predecessor: "search", transaction_partner: ["BPP"] },
        },
    },
    "x-docs": {
        overview: "# Overview\nThis is the overview.",
        "release-notes": "# Release Notes\nVersion 1.0.0",
    },
};

/**
 * Creates a valid `BuildConfig` with sensible defaults. Pass partial overrides
 * to customise specific fields.
 */
export function makeConfig(overrides: Partial<BuildConfig> = {}): BuildConfig {
    return { ...DEFAULT_CONFIG, ...overrides } as BuildConfig;
}

/**
 * Creates a second version of the config with some changes applied — useful
 * for testing diffs.
 */
export function makeUpdatedConfig(overrides: Partial<BuildConfig> = {}): BuildConfig {
    return makeConfig({
        info: {
            ...DEFAULT_CONFIG.info,
            version: "2.0.0",
            "x-usecases": ["uc-alpha", "uc-beta", "uc-gamma"],
            "x-reporting": true,
        },
        "x-flows": [
            // flow-1 modified (description changed + tag added)
            {
                type: "playground",
                id: "flow-1",
                usecase: "uc-alpha",
                tags: ["happy-path", "search", "v2"],
                description: "Updated search flow",
                config: makeFlowConfig("flow-1"),
            },
            // flow-2 removed, flow-3 added
            {
                type: "playground",
                id: "flow-3",
                usecase: "uc-gamma",
                tags: ["confirm"],
                description: "Confirm flow",
                config: makeFlowConfig("flow-3"),
            },
        ],
        "x-errors-codes": {
            code: [
                // 40001 modified
                {
                    Event: "SEARCH_ERR",
                    Description: "Search failed — updated",
                    From: "BAP",
                    code: "40001",
                },
                // 40002 removed, 40003 added
                {
                    Event: "CONFIRM_ERR",
                    Description: "Confirm failed",
                    From: "BPP",
                    code: "40003",
                },
            ],
        },
        "x-supported-actions": {
            supportedActions: {
                search: ["on_search"],
                select: ["on_select"],
                confirm: ["on_confirm"],
            },
            apiProperties: {
                search: { async_predecessor: null, transaction_partner: ["BPP"] },
                select: { async_predecessor: "search", transaction_partner: ["BPP"] },
                confirm: { async_predecessor: "select", transaction_partner: ["BPP"] },
            },
        },
        "x-docs": {
            overview: "# Overview\nUpdated overview.",
            "api-guide": "# API Guide\nNew doc.",
        },
        ...overrides,
    });
}
