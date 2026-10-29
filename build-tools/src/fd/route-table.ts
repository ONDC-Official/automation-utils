import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * FD route table (format v1).
 *
 * FD (ONDC:FIS14:FD) addresses REST resources — `POST /applications/{applicationId}/confirm`,
 * 13 bodiless `GET` reads — where Beckn domains use `POST /<action>`. Every workbench component
 * needs the same answer to "which FD action is this request?", so it is derived once, here,
 * from the operations' `x-fd-*` fields and written into build.yaml as `x-fd-routes`.
 *
 * Only a build whose operations carry `x-fd-action` gets a route table; Beckn builds are
 * untouched. The format is specified in FD-ROUTE-TABLE.md (fd-workbench).
 */

export const FD_ROUTE_FORMAT_VERSION = 1;

const ROLE = z.enum(["INVESTOR_APP", "DEPOSIT_ISSUER", "INDEX"]);

export const FdRouteZ = z.object({
    action: z.string().regex(/^[a-z][a-z0-9_]*$/),
    kind: z.enum(["request", "callback", "webhook"]),
    method: z.enum(["GET", "POST"]),
    path: z.string().startsWith("/"),
    pathParams: z.array(z.string()),
    mode: z.enum(["SYNC", "ASYNC_ACK_CALLBACK", "WEBHOOK"]),
    caller: ROLE,
    callee: ROLE,
    callback: z.string().nullable(),
    inReplyTo: z.string().nullable(),
    hasBody: z.boolean(),
    versionGuard: z.string().nullable(),
    sla: z.string().nullable(),
    requirements: z.array(z.string()),
    operationId: z.string().nullable(),
});

export const FdRouteTableZ = z.object({
    formatVersion: z.literal(FD_ROUTE_FORMAT_VERSION),
    domain: z.string(),
    version: z.string(),
    tableHash: z.string().regex(/^[0-9a-f]{64}$/),
    routes: z.array(FdRouteZ),
});

export type FdRoute = z.infer<typeof FdRouteZ>;
export type FdRouteTable = z.infer<typeof FdRouteTableZ>;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

type Operation = Record<string, unknown>;

function operations(paths: unknown): { path: string; method: string; op: Operation }[] {
    if (!paths || typeof paths !== "object") return [];
    const out: { path: string; method: string; op: Operation }[] = [];
    for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
        if (!item || typeof item !== "object") continue;
        for (const method of METHODS) {
            const op = (item as Record<string, unknown>)[method];
            if (op && typeof op === "object") out.push({ path, method, op: op as Operation });
        }
    }
    return out;
}

/** True when any operation carries `x-fd-action`, i.e. the build is FD. */
export function hasFdOperations(paths: unknown): boolean {
    return operations(paths).some(({ op }) => typeof op["x-fd-action"] === "string");
}

/** The spec writes roles as "N-01 INVESTOR_APP"; the table keeps the role alone. */
function role(value: unknown): string {
    return String(value ?? "").replace(/^N-\d+\s+/, "").trim();
}

function textOrNull(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function kindOf(op: Operation, mode: string): FdRoute["kind"] {
    const declared = op["x-fd-kind"];
    if (declared === "request" || declared === "callback" || declared === "webhook") return declared;
    if (mode === "WEBHOOK") return "webhook";
    return typeof op["x-fd-in-reply-to"] === "string" ? "callback" : "request";
}

/**
 * Builds the route table from build.yaml `paths`. Operations without `x-fd-action` are
 * ignored. Routes are sorted by action, then method, so the table and its hash are stable.
 */
export function deriveFdRoutes(paths: unknown, info: { domain: string; version: string }): FdRouteTable {
    const routes: FdRoute[] = operations(paths)
        .filter(({ op }) => typeof op["x-fd-action"] === "string")
        .map(({ path, method, op }) => {
            const mode = String(op["x-fd-mode"] ?? "");
            const requirements = op["x-fd-requirements"];
            return {
                action: String(op["x-fd-action"]),
                kind: kindOf(op, mode),
                method: method.toUpperCase(),
                path,
                pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
                mode,
                caller: role(op["x-fd-caller"]),
                callee: role(op["x-fd-callee"]),
                callback: textOrNull(op["x-fd-callback"]),
                inReplyTo: textOrNull(op["x-fd-in-reply-to"]),
                hasBody: method !== "get" && op.requestBody !== undefined,
                versionGuard: textOrNull(op["x-fd-version-guard"]),
                sla: textOrNull(op["x-fd-sla"]),
                requirements: Array.isArray(requirements) ? requirements.map(String) : [],
                operationId: textOrNull(op.operationId),
            } as FdRoute;
        })
        .sort((a, b) => a.action.localeCompare(b.action) || a.method.localeCompare(b.method));

    return {
        formatVersion: FD_ROUTE_FORMAT_VERSION,
        domain: info.domain,
        version: info.version,
        tableHash: routesHash(routes),
        routes,
    };
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
        );
    }
    return value;
}

/** JSON with every object's keys sorted, no whitespace — the input to `tableHash`. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

/** sha256 (lower-case hex) of the canonical JSON of `routes`. */
export function routesHash(routes: unknown): string {
    return createHash("sha256").update(canonicalJson(routes), "utf8").digest("hex");
}

/** `/deposits/{depositId}` and `/deposits/{id}` are the same template for matching. */
export function normaliseTemplate(path: string): string {
    return path.replace(/\{[^}]+\}/g, "{}");
}
