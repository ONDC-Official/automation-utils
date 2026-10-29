import { describe, it, expect } from "@jest/globals";
import {
    canonicalJson,
    deriveFdRoutes,
    hasFdOperations,
    routesHash,
} from "../../src/fd/route-table.js";
import { validateFdRoutes } from "../../src/validations/validate-fd-routes.js";
import { BuildConfig } from "../../src/types/build-type.js";
import { makeConfig } from "../fixtures.js";

// A slice of the FD spec as the fd-protocol converter writes it: REST requests, a flattened
// callback and webhook, a GET read, and the literal-vs-param pair /deposits/query vs
// /deposits/{depositId}.
const FD_PATHS = {
    "/applications": {
        post: {
            operationId: "createApplication",
            requestBody: { $ref: "#/components/requestBodies/X" },
            "x-fd-action": "application_create",
            "x-fd-kind": "request",
            "x-fd-callback": "on_application_create",
            "x-fd-mode": "ASYNC_ACK_CALLBACK",
            "x-fd-caller": "N-01 INVESTOR_APP",
            "x-fd-callee": "N-02 DEPOSIT_ISSUER",
            "x-fd-requirements": ["FD-PRD-10"],
        },
    },
    "/on_application_create": {
        post: {
            operationId: "onApplicationCreate",
            requestBody: {},
            "x-fd-action": "on_application_create",
            "x-fd-kind": "callback",
            "x-fd-in-reply-to": "application_create",
            "x-fd-mode": "ASYNC_ACK_CALLBACK",
            "x-fd-caller": "N-02 DEPOSIT_ISSUER",
            "x-fd-callee": "N-01 INVESTOR_APP",
        },
    },
    "/deposits/query": {
        post: {
            operationId: "queryPortfolio",
            requestBody: {},
            "x-fd-action": "portfolio_query",
            "x-fd-kind": "request",
            "x-fd-mode": "SYNC",
            "x-fd-caller": "N-01 INVESTOR_APP",
            "x-fd-callee": "N-02 DEPOSIT_ISSUER",
        },
    },
    "/deposits/{depositId}": {
        parameters: [{ $ref: "#/components/parameters/DepositId" }],
        get: {
            operationId: "readDeposit",
            "x-fd-action": "deposit_read",
            "x-fd-kind": "request",
            "x-fd-mode": "SYNC",
            "x-fd-caller": "N-01 INVESTOR_APP",
            "x-fd-callee": "N-02 DEPOSIT_ISSUER",
            "x-fd-sla": "P95 ≤ 2s",
        },
    },
    "/on_deposit_booked": {
        post: {
            operationId: "onDepositBooked",
            requestBody: {},
            "x-fd-action": "on_deposit_booked",
            "x-fd-kind": "webhook",
            "x-fd-mode": "WEBHOOK",
            "x-fd-caller": "N-02 DEPOSIT_ISSUER",
            "x-fd-callee": "N-01 INVESTOR_APP",
        },
    },
};

const FD_INFO = { domain: "ONDC:FIS14:FD", version: "0.1.4" };

function fdConfig(): BuildConfig {
    const base = makeConfig();
    const routes = deriveFdRoutes(FD_PATHS, FD_INFO);
    return {
        ...base,
        info: { ...base.info, domain: FD_INFO.domain, version: FD_INFO.version },
        paths: FD_PATHS,
        "x-supported-actions": {
            supportedActions: {},
            apiProperties: Object.fromEntries(
                routes.routes.map((r) => [r.action, { async_predecessor: r.inReplyTo, transaction_partner: [] }]),
            ),
        },
        "x-fd-routes": routes,
    };
}

describe("FD route table", () => {
    it("hashes the FD-ROUTE-TABLE.md test vector", () => {
        const routes = [
            {
                action: "deposit_events_read",
                kind: "request",
                method: "GET",
                path: "/deposits/{depositId}/events",
                pathParams: ["depositId"],
                mode: "SYNC",
                caller: "INVESTOR_APP",
                callee: "DEPOSIT_ISSUER",
                callback: null,
                inReplyTo: null,
                hasBody: false,
                versionGuard: null,
                sla: "P95 ≤ 2s",
                requirements: ["FD-LCY-01"],
                operationId: "readDepositEvents",
            },
        ];
        expect(canonicalJson(routes)).toBe(
            '[{"action":"deposit_events_read","callback":null,"callee":"DEPOSIT_ISSUER","caller":"INVESTOR_APP","hasBody":false,"inReplyTo":null,"kind":"request","method":"GET","mode":"SYNC","operationId":"readDepositEvents","path":"/deposits/{depositId}/events","pathParams":["depositId"],"requirements":["FD-LCY-01"],"sla":"P95 ≤ 2s","versionGuard":null}]',
        );
        expect(routesHash(routes)).toBe("9584937ce11f12d3bb38a9e7d30ac81d29918aec87b87bce5f8488b7241484d7");
    });

    it("recognises FD builds and leaves Beckn builds alone", () => {
        expect(hasFdOperations(FD_PATHS)).toBe(true);
        expect(hasFdOperations(makeConfig().paths)).toBe(false);
        expect(hasFdOperations(undefined)).toBe(false);
    });

    it("derives one route per operation, sorted by action", () => {
        const table = deriveFdRoutes(FD_PATHS, FD_INFO);
        expect(table.formatVersion).toBe(1);
        expect(table.routes.map((r) => r.action)).toEqual([
            "application_create",
            "deposit_read",
            "on_application_create",
            "on_deposit_booked",
            "portfolio_query",
        ]);
        const read = table.routes.find((r) => r.action === "deposit_read")!;
        expect(read).toMatchObject({
            kind: "request",
            method: "GET",
            path: "/deposits/{depositId}",
            pathParams: ["depositId"],
            caller: "INVESTOR_APP",
            callee: "DEPOSIT_ISSUER",
            hasBody: false,
            sla: "P95 ≤ 2s",
            requirements: [],
        });
        const callback = table.routes.find((r) => r.action === "on_application_create")!;
        expect(callback).toMatchObject({ kind: "callback", inReplyTo: "application_create", hasBody: true });
        expect(table.tableHash).toBe(routesHash(table.routes));
    });
});

describe("fd-routes validation", () => {
    it("passes a Beckn build without inspecting it", () => {
        expect(validateFdRoutes.run(makeConfig())).toEqual({ ok: true });
    });

    it("passes a consistent FD build", () => {
        expect(validateFdRoutes.run(fdConfig())).toEqual({ ok: true });
    });

    it("rejects a stale hash, a callback without its request, and a missing apiProperties entry", () => {
        const config = fdConfig();
        const table = config["x-fd-routes"]!;
        const routes = table.routes.map((r) =>
            r.action === "on_application_create" ? { ...r, inReplyTo: "application_missing" } : r,
        );
        const broken: BuildConfig = {
            ...config,
            "x-fd-routes": { ...table, routes },
            "x-supported-actions": {
                supportedActions: {},
                apiProperties: { application_create: { async_predecessor: null, transaction_partner: [] } },
            },
        };
        const result = validateFdRoutes.run(broken);
        expect(result.ok).toBe(false);
        const messages = result.ok ? [] : result.issues.map((i) => i.message).join("\n");
        expect(messages).toContain("does not match the routes");
        expect(messages).toContain('request "application_missing" not found');
        expect(messages).toContain('"deposit_read" is missing');
    });

    it("rejects two routes with the same method and template", () => {
        const paths = {
            ...FD_PATHS,
            "/deposits/{id}": { get: { ...FD_PATHS["/deposits/{depositId}"].get, "x-fd-action": "deposit_read_again" } },
        };
        const table = deriveFdRoutes(paths, FD_INFO);
        const config: BuildConfig = {
            ...fdConfig(),
            paths,
            "x-supported-actions": {
                supportedActions: {},
                apiProperties: Object.fromEntries(
                    table.routes.map((r) => [r.action, { async_predecessor: null, transaction_partner: [] }]),
                ),
            },
            "x-fd-routes": table,
        };
        const result = validateFdRoutes.run(config);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((i) => i.message).join("\n")).toContain("ambiguous");
    });
});
