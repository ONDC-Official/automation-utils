import { parse } from "@babel/parser";
import babelTraverseModule, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";

// @babel/traverse default export interop in ESM
const traverse: (
    ast: t.Node,
    visitor: Record<string, unknown>,
) => void =
    ((babelTraverseModule as unknown as { default?: unknown }).default ??
        babelTraverseModule) as unknown as (
        ast: t.Node,
        visitor: Record<string, unknown>,
    ) => void;

export type AccessRecord = {
    /** Fully-resolved chain segments after iteration prefix lifting. */
    segments: string[];
    /** Operation performed at this site. */
    role: "read" | "write" | "delete";
    /** Compact text of the nearest enclosing if/conditional predicate, when assignment. */
    gatedBy?: string;
    /** When the chain root resolves to a session-storage source. */
    sessionKey?: string;
    /** Source offset for snippet capture. */
    loc: { start: number; end: number };
};

export type AnalyzedCode = {
    records: AccessRecord[];
    /** Distinct session keys read in this source, regardless of where they appear. */
    sessionKeys: string[];
};

const _cache = new Map<string, AnalyzedCode>();

export function analyzeSource(src: string): AnalyzedCode {
    if (!src) return { records: [], sessionKeys: [] };
    const cached = _cache.get(src);
    if (cached) return cached;

    let ast: t.File;
    try {
        ast = parse(src, {
            sourceType: "unambiguous",
            errorRecovery: true,
            plugins: ["optionalChaining", "nullishCoalescingOperator"],
            allowReturnOutsideFunction: true,
            allowAwaitOutsideFunction: true,
        });
    } catch {
        const empty = { records: [], sessionKeys: [] };
        _cache.set(src, empty);
        return empty;
    }

    const records: AccessRecord[] = [];
    const sessionKeysSet = new Set<string>();

    // Stack of variable→prefix-segments bindings introduced by callbacks.
    const bindings = new Map<string, string[]>();
    // For nested scopes we push/pop replacements; values are previous bindings (or undefined).
    type Snapshot = Array<{ name: string; prev: string[] | undefined }>;

    const pushBindings = (entries: Array<{ name: string; prefix: string[] }>): Snapshot => {
        const snap: Snapshot = [];
        for (const { name, prefix } of entries) {
            snap.push({ name, prev: bindings.get(name) });
            bindings.set(name, prefix);
        }
        return snap;
    };
    const popBindings = (snap: Snapshot): void => {
        for (const e of snap) {
            if (e.prev === undefined) bindings.delete(e.name);
            else bindings.set(e.name, e.prev);
        }
    };

    /**
     * Resolve a MemberExpression chain to a list of segments + sessionKey hint.
     * Returns null when the chain does not bottom out at a known root.
     */
    const resolveChain = (
        node: t.Node,
    ): { segments: string[]; sessionKey?: string; root?: string } | null => {
        const stack: string[] = [];
        let cur: t.Node = node;
        while (
            t.isMemberExpression(cur) ||
            t.isOptionalMemberExpression(cur)
        ) {
            const obj = cur.object;
            const prop = cur.property;
            if (cur.computed) {
                // foo["bar"] / foo[0]
                if (t.isStringLiteral(prop)) stack.unshift(prop.value);
                else if (t.isNumericLiteral(prop)) stack.unshift(String(prop.value));
                else {
                    // dynamic, give up on this segment
                    return null;
                }
            } else if (t.isIdentifier(prop)) {
                stack.unshift(prop.name);
            } else {
                return null;
            }
            cur = obj;
        }
        if (!t.isIdentifier(cur)) return null;
        const root = cur.name;
        // Session sources
        if (root === "sessionData" || root === "session" || root === "sessionStorage") {
            const sessionKey = stack[0];
            return { segments: stack, sessionKey, root };
        }
        // Apply binding prefix if root is a callback variable.
        const prefix = bindings.get(root);
        if (prefix) {
            return { segments: [...prefix, ...stack], root };
        }
        // Unknown root: still record bare chain so later suffix-match can hit.
        return { segments: stack, root };
    };

    const compactPredicate = (node: t.Node): string => {
        // Keep it small and stable. Walk identifiers + string literals + binary ops.
        const parts: string[] = [];
        const visit = (n: t.Node | null | undefined): void => {
            if (!n) return;
            if (t.isIdentifier(n)) parts.push(n.name);
            else if (t.isStringLiteral(n)) parts.push(`"${n.value}"`);
            else if (t.isNumericLiteral(n)) parts.push(String(n.value));
            else if (t.isBooleanLiteral(n)) parts.push(String(n.value));
            else if (t.isNullLiteral(n)) parts.push("null");
            else if (t.isMemberExpression(n) || t.isOptionalMemberExpression(n)) {
                visit(n.object);
                if (t.isIdentifier(n.property)) parts.push("." + n.property.name);
                else if (t.isStringLiteral(n.property)) parts.push(`["${n.property.value}"]`);
            } else if (t.isBinaryExpression(n) || t.isLogicalExpression(n)) {
                visit(n.left);
                parts.push(" " + n.operator + " ");
                visit(n.right);
            } else if (t.isUnaryExpression(n)) {
                parts.push(n.operator + " ");
                visit(n.argument);
            } else if (t.isCallExpression(n)) {
                visit(n.callee);
                parts.push("(…)");
            }
        };
        visit(node);
        const text = parts.join("").replace(/\s+/g, " ").trim();
        return text.length > 160 ? text.slice(0, 159) + "…" : text;
    };

    /** Walk up to find the nearest `if (test)` / `condExpr ? :` enclosing this path. */
    const findEnclosingPredicate = (path: NodePath): string | undefined => {
        let p: NodePath | null = path.parentPath;
        let hops = 0;
        while (p && hops < 12) {
            if (p.isIfStatement()) return compactPredicate(p.node.test);
            if (p.isConditionalExpression()) return compactPredicate(p.node.test);
            p = p.parentPath;
            hops++;
        }
        return undefined;
    };

    /** Collect bindings from an iteration callback's first parameter, given the parent's chain. */
    const bindingsFromCallback = (
        param: t.Node | undefined,
        parentChain: { segments: string[] } | null,
    ): Array<{ name: string; prefix: string[] }> => {
        if (!param || !parentChain) return [];
        const innerPrefix = [...parentChain.segments, "[*]"];
        if (t.isIdentifier(param)) return [{ name: param.name, prefix: innerPrefix }];
        // Ignore destructured params for now; AST prefix lifting still handles the common case.
        return [];
    };

    const ITER_METHODS = new Set([
        "forEach",
        "map",
        "filter",
        "find",
        "some",
        "every",
        "flatMap",
        "reduce",
    ]);
    const handleIterCallEnter = (
        path: NodePath<t.CallExpression> | NodePath<t.OptionalCallExpression>,
    ): void => {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee)) return;
        const propName = t.isIdentifier(callee.property) ? callee.property.name : null;
        if (!propName) return;
        if (!ITER_METHODS.has(propName)) return;
        const parentChain = resolveChain(callee.object);
        if (!parentChain) return;
        const cb = path.node.arguments[0];
        if (!t.isFunctionExpression(cb) && !t.isArrowFunctionExpression(cb)) return;
        const param = cb.params[0];
        const bs = bindingsFromCallback(param, parentChain);
        if (bs.length === 0) return;
        const snap = pushBindings(bs);
        (path as unknown as { _bindingSnap: Snapshot })._bindingSnap = snap;
    };
    const handleIterCallExit = (
        path: NodePath<t.CallExpression> | NodePath<t.OptionalCallExpression>,
    ): void => {
        const snap = (path as unknown as { _bindingSnap?: Snapshot })._bindingSnap;
        if (snap) popBindings(snap);
    };

    traverse(ast, {
        CallExpression: {
            enter: handleIterCallEnter as (p: NodePath<t.CallExpression>) => void,
            exit: handleIterCallExit as (p: NodePath<t.CallExpression>) => void,
        },
        OptionalCallExpression: {
            enter: handleIterCallEnter as (p: NodePath<t.OptionalCallExpression>) => void,
            exit: handleIterCallExit as (p: NodePath<t.OptionalCallExpression>) => void,
        },

        // for (const x of parent.arr) { … }
        ForOfStatement: {
            enter(path: NodePath<t.ForOfStatement>) {
                const left = path.node.left;
                let varName: string | null = null;
                if (t.isVariableDeclaration(left) && left.declarations[0]) {
                    const id = left.declarations[0].id;
                    if (t.isIdentifier(id)) varName = id.name;
                } else if (t.isIdentifier(left)) {
                    varName = left.name;
                }
                if (!varName) return;
                const parentChain = resolveChain(path.node.right);
                if (!parentChain) return;
                const snap = pushBindings([
                    { name: varName, prefix: [...parentChain.segments, "[*]"] },
                ]);
                (path as unknown as { _bindingSnap: Snapshot })._bindingSnap = snap;
            },
            exit(path: NodePath<t.ForOfStatement>) {
                const snap = (path as unknown as { _bindingSnap?: Snapshot })._bindingSnap;
                if (snap) popBindings(snap);
            },
        },

        // const x = a.b.c     → x aliased to ["a","b","c"]
        // const x = { ...y }   → x aliased to y's binding (spread alias)
        // const x = JSON.parse(JSON.stringify(y))  → x aliased to y's binding (deep-clone alias)
        // const { foo, bar: baz } = a.b.c   → foo, baz aliased
        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
            const node = path.node;
            const init = node.init;
            if (!init) return;

            const resolveAliasInit = (n: t.Node | null | undefined): string[] | null => {
                if (!n) return null;
                // direct member chain
                if (t.isMemberExpression(n) || t.isOptionalMemberExpression(n) || t.isIdentifier(n)) {
                    const c = resolveChain(n);
                    if (c) return c.segments;
                    if (t.isIdentifier(n)) {
                        const b = bindings.get(n.name);
                        if (b) return b;
                    }
                    return null;
                }
                // { ...x } spread alias
                if (t.isObjectExpression(n)) {
                    for (const p of n.properties) {
                        if (t.isSpreadElement(p)) {
                            const a = resolveAliasInit(p.argument);
                            if (a) return a;
                        }
                    }
                    return null;
                }
                // JSON.parse(JSON.stringify(x))   /   structuredClone(x)   /   {...x}
                if (t.isCallExpression(n) || t.isOptionalCallExpression(n)) {
                    const callee = n.callee;
                    // JSON.parse(arg)
                    if (
                        (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
                        t.isIdentifier(callee.object) &&
                        callee.object.name === "JSON" &&
                        t.isIdentifier(callee.property) &&
                        callee.property.name === "parse"
                    ) {
                        return resolveAliasInit(n.arguments[0]);
                    }
                    if (
                        (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
                        t.isIdentifier(callee.object) &&
                        callee.object.name === "JSON" &&
                        t.isIdentifier(callee.property) &&
                        callee.property.name === "stringify"
                    ) {
                        return resolveAliasInit(n.arguments[0]);
                    }
                    if (t.isIdentifier(callee) && callee.name === "structuredClone") {
                        return resolveAliasInit(n.arguments[0]);
                    }
                }
                return null;
            };

            const aliasSegs = resolveAliasInit(init);
            if (aliasSegs) {
                if (t.isIdentifier(node.id)) {
                    bindings.set(node.id.name, aliasSegs);
                    return;
                }
                if (t.isObjectPattern(node.id)) {
                    for (const prop of node.id.properties) {
                        if (!t.isObjectProperty(prop)) continue;
                        const key = prop.key;
                        const val = prop.value;
                        if (!t.isIdentifier(key)) continue;
                        if (!t.isIdentifier(val)) continue;
                        bindings.set(val.name, [...aliasSegs, key.name]);
                    }
                }
            }
        },

        // Record reads/writes/deletes
        AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
            const left = path.node.left;
            const chain = t.isMemberExpression(left) || t.isOptionalMemberExpression(left)
                ? resolveChain(left)
                : null;
            if (!chain || chain.segments.length === 0) return;
            const rec: AccessRecord = {
                segments: chain.segments,
                role: "write",
                loc: { start: left.start ?? 0, end: left.end ?? 0 },
            };
            const gated = findEnclosingPredicate(path);
            if (gated) rec.gatedBy = gated;
            if (chain.sessionKey) {
                rec.sessionKey = chain.sessionKey;
                sessionKeysSet.add(chain.sessionKey);
            }
            records.push(rec);
        },

        UnaryExpression(path: NodePath<t.UnaryExpression>) {
            if (path.node.operator !== "delete") return;
            const arg = path.node.argument;
            const chain = t.isMemberExpression(arg) || t.isOptionalMemberExpression(arg)
                ? resolveChain(arg)
                : null;
            if (!chain || chain.segments.length === 0) return;
            const rec: AccessRecord = {
                segments: chain.segments,
                role: "delete",
                loc: { start: arg.start ?? 0, end: arg.end ?? 0 },
            };
            if (chain.sessionKey) {
                rec.sessionKey = chain.sessionKey;
                sessionKeysSet.add(chain.sessionKey);
            }
            records.push(rec);
        },

        MemberExpression(path: NodePath<t.MemberExpression>) {
            const pp = path.parentPath;
            // Skip if this member is itself the LHS of an assignment (already recorded)
            if (pp && pp.isAssignmentExpression() && pp.node.left === path.node) return;
            // Skip if this member is the argument of `delete`
            if (
                pp &&
                pp.isUnaryExpression() &&
                pp.node.operator === "delete" &&
                pp.node.argument === path.node
            )
                return;
            // Skip if this member is the object of a deeper member (covered by outer match)
            if (pp && pp.isMemberExpression() && pp.node.object === path.node) return;
            if (
                pp &&
                pp.isOptionalMemberExpression() &&
                pp.node.object === path.node
            )
                return;
            const chain = resolveChain(path.node);
            if (!chain || chain.segments.length === 0) return;
            const rec: AccessRecord = {
                segments: chain.segments,
                role: "read",
                loc: { start: path.node.start ?? 0, end: path.node.end ?? 0 },
            };
            if (chain.sessionKey) {
                rec.sessionKey = chain.sessionKey;
                sessionKeysSet.add(chain.sessionKey);
            }
            records.push(rec);
        },

        OptionalMemberExpression(path: NodePath<t.OptionalMemberExpression>) {
            const pp = path.parentPath;
            if (pp && pp.isMemberExpression() && pp.node.object === path.node) return;
            if (
                pp &&
                pp.isOptionalMemberExpression() &&
                pp.node.object === path.node
            )
                return;
            const chain = resolveChain(path.node);
            if (!chain || chain.segments.length === 0) return;
            const rec: AccessRecord = {
                segments: chain.segments,
                role: "read",
                loc: { start: path.node.start ?? 0, end: path.node.end ?? 0 },
            };
            if (chain.sessionKey) {
                rec.sessionKey = chain.sessionKey;
                sessionKeysSet.add(chain.sessionKey);
            }
            records.push(rec);
        },
    });

    const result: AnalyzedCode = {
        records,
        sessionKeys: Array.from(sessionKeysSet),
    };
    _cache.set(src, result);
    return result;
}

export function clearAnalyzerCache(): void {
    _cache.clear();
}

/**
 * Returns the source span around an offset, with a couple of context lines either side.
 */
export function captureSnippet(src: string, start: number): string {
    const before = src.lastIndexOf("\n", Math.max(0, start - 1));
    let end = start;
    for (let i = 0; i < 3; i++) {
        const next = src.indexOf("\n", end + 1);
        if (next < 0) {
            end = src.length;
            break;
        }
        end = next;
    }
    let s = before;
    for (let i = 0; i < 2; i++) {
        const prev = src.lastIndexOf("\n", Math.max(0, s - 1));
        if (prev < 0) {
            s = 0;
            break;
        }
        s = prev;
    }
    return src.slice(Math.max(0, s), end).trim();
}

/** snake_case ↔ camelCase utility for matching gap segments. */
export function caseVariants(segs: string[]): string[][] {
    const camelOf = (s: string): string =>
        s.includes("_") ? s.replace(/_([a-z0-9])/g, (_m, c: string) => (c as string).toUpperCase()) : s;
    const snakeOf = (s: string): string =>
        s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const eq = (a: string[], b: string[]): boolean =>
        a.length === b.length && a.every((x, i) => x === b[i]);
    const out: string[][] = [segs];
    const snake = segs.map(snakeOf);
    const camel = segs.map(camelOf);
    if (!eq(snake, segs)) out.push(snake);
    if (!eq(camel, segs) && !out.some((v) => eq(v, camel))) out.push(camel);
    return out;
}

/** Suffix match, ignoring `[*]` placeholders and numeric segments in the haystack. */
export function suffixMatches(needle: string[], haystack: string[]): boolean {
    if (needle.length === 0) return false;
    const filtered = haystack.filter((s) => s !== "[*]" && !/^\d+$/.test(s));
    if (needle.length > filtered.length) return false;
    const start = filtered.length - needle.length;
    for (let i = 0; i < needle.length; i++) {
        if (filtered[start + i] !== needle[i]) return false;
    }
    return true;
}
