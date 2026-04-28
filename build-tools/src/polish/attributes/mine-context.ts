import type { BuildConfig } from "../../types/build-type.js";
import type {
    ContextBundle,
    CrossFlowSignals,
    EnumEntry,
    ExistingLeafInfo,
    LeafObservation,
    ReferenceHit,
    SaveDataHit,
    SessionReadHit,
    TagEntry,
} from "./types.js";
import { decodeBase64 } from "./base64.js";
import { lookupOpenApi } from "./openapi-lookup.js";
import { scanCommentsOnly, scanSaveData } from "./reference-scanner.js";
import { lookupExistingLeaf } from "./placeholder.js";
import {
    analyzeSource,
    captureSnippet,
    caseVariants,
    suffixMatches,
    type AccessRecord,
    type AnalyzedCode,
} from "./code-analyzer.js";

type FlowStep = {
    api?: string;
    action_id?: string;
    mock?: {
        generate?: string;
        validate?: string;
        requirements?: string;
        saveData?: Record<string, unknown>;
    };
};

type FlowCfg = { steps?: FlowStep[] };

const MAX_REFS_PER_ATTR = 8;
const MAX_SESSION_READS = 4;

type DecodedStep = {
    flowId: string;
    actionId: string;
    stepAction: string;
    generate: string;
    validate: string;
    requirements: string;
    saveData: Record<string, unknown>;
    /** Per-source AST analysis, computed lazily and cached by source-hash inside analyzer. */
    generateAst: AnalyzedCode;
    validateAst: AnalyzedCode;
    requirementsAst: AnalyzedCode;
};

type SessionProducer = {
    action: string;
    jsonpath: string;
    jsonpathSegs: string[];
    flowId: string;
    actionId: string;
};

export type MineProgress = (info: {
    action: string;
    done: number;
    total: number;
    pathKey: string;
    elapsedMs: number;
}) => void;

function jsonpathToSegs(jp: string): string[] {
    return jp
        .replace(/^\$\.?/, "")
        .split(".")
        .flatMap((p) => p.split(/\[[^\]]*\]/))
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !/^\d+$/.test(s));
}

function isStrictAncestor(ancestor: string[], descendant: string[]): boolean {
    if (ancestor.length === 0 || ancestor.length >= descendant.length) return false;
    for (let i = 0; i < ancestor.length; i++) {
        if (ancestor[i] !== descendant[i]) return false;
    }
    return true;
}

function buildSessionProducerMap(allSteps: DecodedStep[]): Map<string, SessionProducer[]> {
    const map = new Map<string, SessionProducer[]>();
    for (const s of allSteps) {
        for (const [key, raw] of Object.entries(s.saveData)) {
            if (typeof raw !== "string") continue;
            const jp = raw.trim();
            if (!jp) continue;
            const segs = jsonpathToSegs(jp);
            const entry: SessionProducer = {
                action: s.stepAction,
                jsonpath: jp,
                jsonpathSegs: segs,
                flowId: s.flowId,
                actionId: s.actionId,
            };
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(entry);
        }
    }
    return map;
}

export function buildBundles(
    config: BuildConfig,
    observations: LeafObservation[],
    onProgress?: MineProgress,
): ContextBundle[] {
    if (observations.length === 0) return [];
    const action = observations[0]!.action;

    // Decode + analyze every step once.
    const allSteps: DecodedStep[] = [];
    for (const flow of config["x-flows"] ?? []) {
        const cfg = flow.config as FlowCfg | undefined;
        for (const step of cfg?.steps ?? []) {
            const a = step.api;
            if (!a) continue;
            const generate = decodeBase64(step.mock?.generate ?? "");
            const validate = decodeBase64(step.mock?.validate ?? "");
            const requirements = decodeBase64(step.mock?.requirements ?? "");
            allSteps.push({
                flowId: flow.id,
                actionId: step.action_id ?? a,
                stepAction: a,
                generate,
                validate,
                requirements,
                saveData:
                    step.mock?.saveData && typeof step.mock.saveData === "object"
                        ? (step.mock.saveData as Record<string, unknown>)
                        : {},
                generateAst: analyzeSource(generate),
                validateAst: analyzeSource(validate),
                requirementsAst: analyzeSource(requirements),
            });
        }
    }

    const sameActionSteps = allSteps.filter((s) => s.stepAction === action);
    const producerMap = buildSessionProducerMap(allSteps);

    const out: ContextBundle[] = [];
    let i = 0;
    for (const obs of observations) {
        const obsStarted = Date.now();
        const segs = obs.path.slice(1); // drop action prefix
        const variants = caseVariants(segs);

        const refs: ReferenceHit[] = [];
        const saveData: SaveDataHit[] = [];
        const sessionReads: SessionReadHit[] = [];

        const byKind: Record<string, ReferenceHit[]> = {
            generate: [],
            validate: [],
            requirements: [],
            comment: [],
            alias: [],
        };
        const pushKind = (h: ReferenceHit): void => {
            const arr = byKind[h.kind] ?? (byKind[h.kind] = []);
            arr.push(h);
        };

        // 1. AST-based refs from same-action steps
        for (const s of sameActionSteps) {
            const collect = (
                analyzed: AnalyzedCode,
                src: string,
                kind: ReferenceHit["kind"],
                cap: number,
            ): void => {
                let n = 0;
                for (const r of analyzed.records) {
                    if (n >= cap) break;
                    if (!variantMatches(r, variants)) continue;
                    const hit: ReferenceHit = {
                        flowId: s.flowId,
                        actionId: s.actionId,
                        kind,
                        snippet: captureSnippet(src, r.loc.start),
                        matchedChain: r.segments.join("."),
                        role: r.role,
                    };
                    if (r.gatedBy) hit.gatedBy = r.gatedBy;
                    pushKind(hit);
                    n++;
                }
            };
            collect(s.generateAst, s.generate, "generate", 4);
            collect(s.validateAst, s.validate, "validate", 4);
            collect(s.requirementsAst, s.requirements, "requirements", 2);

            // Direct saveData matches (same action)
            for (const sd of scanSaveData(s.saveData, segs)) {
                saveData.push({ flowId: s.flowId, actionId: s.actionId, ...sd });
            }
        }

        // 2. Inherited saveData: any step's saveData entry whose jsonpath is a strict ancestor of segs
        const segsNorm = segs.filter((s) => !/^\d+$/.test(s));
        for (const s of allSteps) {
            for (const [key, raw] of Object.entries(s.saveData)) {
                if (typeof raw !== "string") continue;
                const jp = raw.trim();
                if (!jp) continue;
                const ancestorSegs = jsonpathToSegs(jp);
                if (!isStrictAncestor(ancestorSegs, segsNorm)) continue;
                // Skip duplicates already covered by direct match
                if (
                    saveData.some(
                        (h) =>
                            h.key === key &&
                            h.flowId === s.flowId &&
                            h.actionId === s.actionId,
                    )
                )
                    continue;
                saveData.push({
                    flowId: s.flowId,
                    actionId: s.actionId,
                    key,
                    jsonpath: jp,
                    inherited: true,
                    ancestorJsonpath: jp,
                });
            }
        }

        // 3. Session reads in this action's source: any record with sessionKey set
        //    whose producer's jsonpath is the gap or a strict ancestor.
        for (const s of sameActionSteps) {
            if (sessionReads.length >= MAX_SESSION_READS) break;
            const collectSession = (analyzed: AnalyzedCode, src: string): void => {
                for (const r of analyzed.records) {
                    if (sessionReads.length >= MAX_SESSION_READS) return;
                    if (!r.sessionKey) continue;
                    const producers = producerMap.get(r.sessionKey);
                    if (!producers || producers.length === 0) {
                        // Producer unknown (key written elsewhere or unaliased).
                        // Still emit if the variant matches further down the chain.
                        if (variantMatches(r, variants)) {
                            sessionReads.push({
                                sessionKey: r.sessionKey,
                                snippet: captureSnippet(src, r.loc.start),
                            });
                        }
                        continue;
                    }
                    for (const p of producers) {
                        // Match if producer wrote exactly this attribute, OR an ancestor of it
                        const eq =
                            p.jsonpathSegs.length === segsNorm.length &&
                            p.jsonpathSegs.every((seg, idx) => seg === segsNorm[idx]);
                        const ancestor = isStrictAncestor(p.jsonpathSegs, segsNorm);
                        if (!eq && !ancestor) continue;
                        sessionReads.push({
                            sessionKey: r.sessionKey,
                            snippet: captureSnippet(src, r.loc.start),
                            originAction: p.action,
                            originPath: p.jsonpath,
                            originFlow: p.flowId,
                        });
                        if (sessionReads.length >= MAX_SESSION_READS) return;
                    }
                }
            };
            collectSession(s.generateAst, s.generate);
            collectSession(s.validateAst, s.validate);
            collectSession(s.requirementsAst, s.requirements);
        }

        // 4. Comments: regex scan (AST drops them)
        for (const s of sameActionSteps) {
            const blob = s.generate + "\n" + s.validate + "\n" + s.requirements;
            const hits = scanCommentsOnly(
                blob,
                segs,
                { flowId: s.flowId, actionId: s.actionId },
                2,
            );
            for (const h of hits) pushKind(h);
        }

        // 5. Alias indirection: persisted key surfaced in OTHER steps as identifier.
        const persistedKey = saveData.length > 0 ? saveData[0]!.key : undefined;
        if (persistedKey) {
            for (const s of allSteps) {
                if (s.stepAction === action) continue;
                const blob = s.generate + "\n" + s.validate + "\n" + s.requirements;
                if (!new RegExp(`\\b${escapeRegex(persistedKey)}\\b`).test(blob)) continue;
                pushKind({
                    flowId: s.flowId,
                    actionId: s.actionId,
                    kind: "alias",
                    snippet: persistedKey,
                    matchedChain: persistedKey,
                });
                break;
            }
        }

        // Pull hits into refs[] in a kind-diverse order.
        const order: ReferenceHit["kind"][] = [
            "generate",
            "validate",
            "requirements",
            "comment",
            "alias",
        ];
        for (const k of order) {
            const arr = byKind[k] ?? [];
            if (arr.length > 0 && refs.length < MAX_REFS_PER_ATTR) refs.push(arr.shift()!);
        }
        for (const k of order) {
            const arr = byKind[k] ?? [];
            for (const h of arr) {
                if (refs.length >= MAX_REFS_PER_ATTR) break;
                refs.push(h);
            }
            if (refs.length >= MAX_REFS_PER_ATTR) break;
        }

        const openapi = lookupOpenApi(config, obs.action, segs);
        const existing = extractExistingLeafInfo(config, obs);
        const crossFlow = computeCrossFlow(allSteps, segs, action, persistedKey);

        const bundle: ContextBundle = {
            obs,
            openapi,
            refs,
            saveData,
            existing,
            crossFlow,
        };
        if (sessionReads.length > 0) bundle.sessionReads = sessionReads;
        out.push(bundle);

        i++;
        if (onProgress) {
            onProgress({
                action,
                done: i,
                total: observations.length,
                pathKey: obs.pathKey,
                elapsedMs: Date.now() - obsStarted,
            });
        }
    }

    return out;
}

function variantMatches(r: AccessRecord, variants: string[][]): boolean {
    for (const v of variants) {
        if (suffixMatches(v, r.segments)) return true;
        if (v.length >= 3 && suffixMatches(v.slice(-3), r.segments)) return true;
    }
    return false;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function snakeToCamel(s: string): string {
    if (!s.includes("_")) return s;
    return s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function camelToSnake(s: string): string {
    return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function presenceTokens(gapSegs: string[]): string[] {
    if (gapSegs.length === 0) return [];
    const last = gapSegs[gapSegs.length - 1]!;
    const tail2 = gapSegs.slice(-2).join(".");
    const tail3 = gapSegs.slice(-3).join(".");
    const camelLast = snakeToCamel(last);
    const snakeLast = camelToSnake(last);
    const set = new Set<string>([last, tail2, tail3, camelLast, snakeLast].filter(Boolean));
    set.add(tail2.split(".").map(snakeToCamel).join("."));
    set.add(tail2.split(".").map(camelToSnake).join("."));
    return Array.from(set).filter((t) => t.length >= 3);
}

function anyTokenPresent(blob: string, tokens: string[]): boolean {
    for (const t of tokens) {
        if (blob.includes(t)) return true;
    }
    return false;
}

function computeCrossFlow(
    allSteps: Array<{
        stepAction: string;
        generate: string;
        validate: string;
        requirements: string;
    }>,
    gapSegs: string[],
    selfAction: string,
    persistedKey?: string,
): CrossFlowSignals {
    const tokens = presenceTokens(gapSegs);
    let setInGenerate = false;
    let assertedInValidate = false;
    let requiredInRequirements = false;
    let consumedAcrossSteps = false;

    const persistedTok = persistedKey ?? "";
    for (const s of allSteps) {
        if (!setInGenerate && anyTokenPresent(s.generate, tokens)) setInGenerate = true;
        if (!assertedInValidate && anyTokenPresent(s.validate, tokens)) assertedInValidate = true;
        if (!requiredInRequirements && anyTokenPresent(s.requirements, tokens))
            requiredInRequirements = true;
        if (
            persistedTok &&
            !consumedAcrossSteps &&
            s.stepAction !== selfAction &&
            (s.generate.includes(persistedTok) ||
                s.validate.includes(persistedTok) ||
                s.requirements.includes(persistedTok))
        ) {
            consumedAcrossSteps = true;
        }
        if (
            setInGenerate &&
            assertedInValidate &&
            requiredInRequirements &&
            (!persistedTok || consumedAcrossSteps)
        )
            break;
    }

    const out: CrossFlowSignals = {
        setInGenerate,
        assertedInValidate,
        requiredInRequirements,
        consumedAcrossSteps,
    };
    if (persistedKey) out.persistedKey = persistedKey;
    return out;
}

function extractExistingLeafInfo(
    config: BuildConfig,
    obs: LeafObservation,
): ExistingLeafInfo | null {
    const sets = config["x-attributes"] ?? [];
    const leaf = lookupExistingLeaf(sets, obs.ucId, obs.path);
    if (!leaf || typeof leaf !== "object") return null;
    const raw = leaf as Record<string, unknown>;
    const info: ExistingLeafInfo = { leaf: raw };

    const existingEnums = coerceEnumArray(raw["enums"]);
    if (existingEnums.length > 0) info.enums = existingEnums;

    const existingTags = coerceTagArray(raw["tags"]);
    if (existingTags.length > 0) info.tags = existingTags;

    return info.enums || info.tags ? info : { leaf: raw };
}

function coerceEnumArray(v: unknown): EnumEntry[] {
    if (!Array.isArray(v)) return [];
    const out: EnumEntry[] = [];
    for (const item of v) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        if (typeof o["code"] !== "string") continue;
        out.push({
            code: o["code"],
            description: typeof o["description"] === "string" ? o["description"] : "",
            reference: typeof o["reference"] === "string" ? o["reference"] : "",
        });
    }
    return out;
}

function coerceTagArray(v: unknown): TagEntry[] {
    if (!Array.isArray(v)) return [];
    const out: TagEntry[] = [];
    for (const item of v) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const code = typeof o["code"] === "string" ? o["code"] : null;
        if (!code) continue;
        const desc = (o["_description"] ?? {}) as Record<string, unknown>;
        out.push({
            code,
            _description: {
                required: Boolean(desc["required"]),
                usage: String(desc["usage"] ?? ""),
                info: String(desc["info"] ?? ""),
                owner: String(desc["owner"] ?? ""),
                type: String(desc["type"] ?? ""),
            },
            list: Array.isArray(o["list"])
                ? (o["list"] as unknown[])
                      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
                      .map((x) => ({
                          code: String(x["code"] ?? ""),
                          _description: {
                              required: Boolean(
                                  (x["_description"] as Record<string, unknown> | undefined)?.[
                                      "required"
                                  ],
                              ),
                              usage: String(
                                  (x["_description"] as Record<string, unknown> | undefined)?.[
                                      "usage"
                                  ] ?? "",
                              ),
                              info: String(
                                  (x["_description"] as Record<string, unknown> | undefined)?.[
                                      "info"
                                  ] ?? "",
                              ),
                              owner: String(
                                  (x["_description"] as Record<string, unknown> | undefined)?.[
                                      "owner"
                                  ] ?? "",
                              ),
                              type: String(
                                  (x["_description"] as Record<string, unknown> | undefined)?.[
                                      "type"
                                  ] ?? "",
                              ),
                          },
                      }))
                : undefined,
        });
    }
    return out;
}
