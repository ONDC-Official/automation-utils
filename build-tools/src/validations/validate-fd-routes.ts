import type { BuildConfig } from "../types/build-type.js";
import type { ValidationCheck, ValidationIssue, ValidationResult } from "./types.js";
import {
    canonicalJson,
    deriveFdRoutes,
    normaliseTemplate,
    routesHash,
    type FdRoute,
} from "../fd/route-table.js";

/**
 * FD builds only (those carrying `x-fd-routes`): checks the route table every workbench
 * component relies on. Beckn builds pass without being inspected.
 */
export const validateFdRoutes: ValidationCheck = {
    name: "fd-routes",
    description: "FD route table is complete, consistent with paths and unambiguous",
    run(config: BuildConfig): ValidationResult {
        const table = config["x-fd-routes"];
        if (!table) return { ok: true };

        const issues: ValidationIssue[] = [];
        const add = (path: string, message: string) => issues.push({ path, message });

        if (table.tableHash !== routesHash(table.routes)) {
            add("x-fd-routes.tableHash", "does not match the routes; re-run parse");
        }
        const derived = deriveFdRoutes(config.paths, { domain: table.domain, version: table.version });
        if (canonicalJson(derived.routes) !== canonicalJson(table.routes)) {
            add("x-fd-routes.routes", "differs from the routes derived from paths; re-run parse");
        }
        if (table.domain !== config.info.domain || table.version !== config.info.version) {
            add("x-fd-routes", `domain/version ${table.domain} ${table.version} differ from info`);
        }

        const byAction = new Map<string, FdRoute>();
        const templates = new Map<string, string>();
        for (const route of table.routes) {
            const where = `x-fd-routes (${route.method} ${route.path})`;
            if (byAction.has(route.action)) add(where, `action "${route.action}" is declared twice`);
            byAction.set(route.action, route);

            const key = `${route.method} ${normaliseTemplate(route.path)}`;
            const clash = templates.get(key);
            if (clash) add(where, `ambiguous with ${clash}: same method and template`);
            templates.set(key, `${route.method} ${route.path}`);

            if (route.method === "GET" && route.hasBody) add(where, "a GET read must not have a body");
            if (route.kind === "request" && route.mode === "ASYNC_ACK_CALLBACK" && !route.callback) {
                add(where, `asynchronous action "${route.action}" declares no callback`);
            }
            if (route.kind === "callback" && !route.inReplyTo) {
                add(where, `callback "${route.action}" does not name its request`);
            }
            if (route.kind === "webhook" && route.mode !== "WEBHOOK") {
                add(where, `webhook "${route.action}" has mode ${route.mode}`);
            }
        }

        for (const route of table.routes) {
            if (route.kind === "callback" && route.inReplyTo) {
                const request = byAction.get(route.inReplyTo);
                if (!request) add(`x-fd-routes (${route.action})`, `request "${route.inReplyTo}" not found`);
                else if (request.callback !== route.action) {
                    add(`x-fd-routes (${route.action})`, `"${route.inReplyTo}" names callback "${request.callback}"`);
                }
            }
        }

        const apiProperties = config["x-supported-actions"].apiProperties;
        for (const action of byAction.keys()) {
            if (!(action in apiProperties)) {
                add("x-supported-actions.apiProperties", `"${action}" is missing`);
            }
        }

        const tests = (config["x-validations"] as { _TESTS_?: Record<string, unknown> } | undefined)?._TESTS_;
        for (const key of Object.keys(tests ?? {})) {
            if (!byAction.has(key)) add("x-validations._TESTS_", `"${key}" is not an FD action`);
        }

        return issues.length === 0 ? { ok: true } : { ok: false, issues };
    },
};
