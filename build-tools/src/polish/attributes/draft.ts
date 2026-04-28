import type { ILLMProvider } from "../../knowledge-book/llm/types.js";
import type { ContextBundle, EnumEntry, LeafDraft, TagEntry } from "./types.js";

export const BATCH_SIZE = 30;
const RETRY_ATTEMPTS = 1;

export type BatchEvent =
    | { kind: "start"; batchIndex: number; batches: number; size: number }
    | {
          kind: "ok";
          batchIndex: number;
          batches: number;
          size: number;
          attempt: number;
          elapsedMs: number;
      }
    | {
          kind: "retry";
          batchIndex: number;
          batches: number;
          size: number;
          attempt: number;
          reason: string;
      }
    | {
          kind: "fallback";
          batchIndex: number;
          batches: number;
          size: number;
          reason: string;
      };

export type BatchEventHandler = (ev: BatchEvent) => void;

type LLMInputAttr = {
    path: string;
    action: string;
    is_leaf: boolean;
    value_type: string;
    sample_values: unknown[];
    most_common_value?: unknown;
    observed_in_flows: string[];
    is_array_indexed: boolean;
    openapi: {
        description?: string;
        custom?: Record<string, unknown>;
        type?: string;
    } | null;
    existing_enums?: EnumEntry[];
    existing_tags?: TagEntry[];
    existing_leaf?: Record<string, unknown>;
    referenced_in: Array<{
        flow: string;
        action_id: string;
        kind: string;
        snippet: string;
        role?: "read" | "write" | "delete";
        gated_by?: string;
    }>;
    save_data: Array<{
        flow: string;
        key: string;
        jsonpath: string;
        inherited?: boolean;
        ancestor_jsonpath?: string;
    }>;
    session_reads?: Array<{
        session_key: string;
        snippet: string;
        origin_action?: string;
        origin_path?: string;
        origin_flow?: string;
    }>;
    gated_writes?: Array<{ snippet: string; gated_by: string; flow: string; action_id: string }>;
    cross_flow?: {
        set_in_generate: boolean;
        asserted_in_validate: boolean;
        required_in_requirements: boolean;
        persisted_key?: string;
        consumed_across_steps: boolean;
    };
};

export type DraftItem = { action: string; bundle: ContextBundle };

export async function draftLeaves(
    llm: ILLMProvider,
    items: DraftItem[],
    onEvent?: BatchEventHandler,
): Promise<LeafDraft[]> {
    const drafts: LeafDraft[] = [];
    const batches = Math.max(1, Math.ceil(items.length / BATCH_SIZE));
    for (let i = 0, b = 0; i < items.length; i += BATCH_SIZE, b++) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const size = batch.length;
        onEvent?.({ kind: "start", batchIndex: b, batches, size });

        const inputs = batch.map(itemToLLMInput);
        const bundles = batch.map((it) => it.bundle);
        const { drafts: batchDrafts } = await draftBatchWithRetry(
            llm,
            bundles,
            inputs,
            (ev) =>
                onEvent?.({
                    ...ev,
                    batchIndex: b,
                    batches,
                    size,
                }),
        );
        drafts.push(...batchDrafts);
    }
    return drafts;
}

type InnerEvent =
    | { kind: "ok"; attempt: number; elapsedMs: number }
    | { kind: "retry"; attempt: number; reason: string }
    | { kind: "fallback"; reason: string };

async function draftBatchWithRetry(
    llm: ILLMProvider,
    bundles: ContextBundle[],
    inputs: LLMInputAttr[],
    onEvent: (ev: InnerEvent) => void,
): Promise<{ drafts: LeafDraft[] }> {
    let lastReason = "";
    for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
        const started = Date.now();
        const prompt = buildPrompt(inputs, attempt > 0 ? lastReason : "");
        try {
            const raw = await llm.complete([{ role: "user", content: prompt }]);
            const parsed = parseDraftJson(raw, bundles.length);
            const reconciled = reconcileWithExisting(parsed, bundles);
            onEvent({ kind: "ok", attempt, elapsedMs: Date.now() - started });
            return { drafts: reconciled };
        } catch (err) {
            lastReason = err instanceof Error ? err.message : String(err);
            if (attempt < RETRY_ATTEMPTS) {
                onEvent({ kind: "retry", attempt: attempt + 1, reason: lastReason });
                continue;
            }
            onEvent({ kind: "fallback", reason: lastReason });
            return { drafts: bundles.map((b) => dummyDraft(b, lastReason)) };
        }
    }
    // unreachable
    return { drafts: bundles.map((b) => dummyDraft(b, lastReason)) };
}

export function itemToLLMInput(it: DraftItem): LLMInputAttr {
    const b = it.bundle;
    const out: LLMInputAttr = {
        path: b.obs.pathKey,
        action: it.action,
        is_leaf: b.obs.isLeaf,
        value_type: b.obs.valueType,
        sample_values: b.obs.sampleValues.slice(0, 8),
        observed_in_flows: b.obs.seenInFlows.slice(0, 5),
        is_array_indexed: b.obs.isArrayIndexed,
        openapi: b.openapi
            ? {
                  description: b.openapi.description,
                  custom: b.openapi.customDescription,
                  type: b.openapi.type,
              }
            : null,
        existing_enums: b.existing?.enums,
        existing_tags: b.existing?.tags,
        existing_leaf: b.existing?.leaf,
        referenced_in: b.refs.map((r) => {
            const o: LLMInputAttr["referenced_in"][number] = {
                flow: r.flowId,
                action_id: r.actionId,
                kind: r.kind,
                snippet: r.snippet,
            };
            if (r.role) o.role = r.role;
            if (r.gatedBy) o.gated_by = r.gatedBy;
            return o;
        }),
        save_data: b.saveData.map((s) => {
            const o: LLMInputAttr["save_data"][number] = {
                flow: s.flowId,
                key: s.key,
                jsonpath: s.jsonpath,
            };
            if (s.inherited) o.inherited = true;
            if (s.ancestorJsonpath) o.ancestor_jsonpath = s.ancestorJsonpath;
            return o;
        }),
    };
    if (b.sessionReads && b.sessionReads.length > 0) {
        out.session_reads = b.sessionReads.map((sr) => {
            const o: NonNullable<LLMInputAttr["session_reads"]>[number] = {
                session_key: sr.sessionKey,
                snippet: sr.snippet,
            };
            if (sr.originAction) o.origin_action = sr.originAction;
            if (sr.originPath) o.origin_path = sr.originPath;
            if (sr.originFlow) o.origin_flow = sr.originFlow;
            return o;
        });
    }
    const gw = b.refs
        .filter((r) => r.role === "write" && r.gatedBy)
        .map((r) => ({
            snippet: r.snippet,
            gated_by: r.gatedBy!,
            flow: r.flowId,
            action_id: r.actionId,
        }));
    if (gw.length > 0) out.gated_writes = gw;
    if (b.obs.mostCommonValue !== undefined) out.most_common_value = b.obs.mostCommonValue;
    if (b.crossFlow) {
        out.cross_flow = {
            set_in_generate: b.crossFlow.setInGenerate,
            asserted_in_validate: b.crossFlow.assertedInValidate,
            required_in_requirements: b.crossFlow.requiredInRequirements,
            consumed_across_steps: b.crossFlow.consumedAcrossSteps,
        };
        if (b.crossFlow.persistedKey) out.cross_flow.persisted_key = b.crossFlow.persistedKey;
    }
    return out;
}

export function buildPrompt(inputs: LLMInputAttr[], retryReason: string): string {
    const correction = retryReason
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${retryReason}\nReturn a JSON array of EXACTLY ${inputs.length} objects in the SAME ORDER as the input. Each object must match the LeafDescription type. No prose. No partial output.`
        : "";

    return `You are an ONDC protocol documentation writer. Your audience is a partner integrator (BAP or BPP engineer) implementing this action for the first time. Each attribute they read about must teach them what it means in the ONDC domain, when it is set, when it is read, and any non-obvious constraint — anchored in the evidence provided.

You will receive an array of attribute inputs. For EACH input produce ONE LeafDescription JSON object with this EXACT shape:

{
  "info": string,                                      // REQUIRED. 1–3 sentences. Domain-focused prose.
  "enums"?: [{ "code": string, "description": string, "reference": string }],
  "tags"?:  [{ "code": string, "_description": LeafDescription, "list"?: [{ "code": string, "_description": LeafDescription }] }]
}

DO NOT include \`usage\`, \`type\`, \`required\`, or \`owner\`. They are derived deterministically downstream from sample values and the action name. If you include them, they will be discarded.

────────────────────────────────────────
EVIDENCE HIERARCHY — anchor "info" in this order
────────────────────────────────────────
1. \`openapi.description\` and \`openapi.custom\` — authoritative ONDC specification text. Trust this first.
2. \`existing_leaf\` — prior human-curated description fragments, including any inner \`info\` field. Prefer rephrasing this over inventing new prose.
3. \`referenced_in\` — code snippets showing how the attribute is set (\`generate\`), checked (\`validate\`), required (\`requirements\`), or aliased through saveData. Each entry now carries:
   - \`role\`: "read" | "write" | "delete" — what the code does at this site.
   - \`gated_by\` (when present): the predicate that gates the operation, e.g. \`tag.descriptor.code === "LOAN_INFO"\`. Reflect the gating condition in "info" when material.
4. \`save_data\` — entries with \`inherited: true\` mean the attribute is persisted as part of an ancestor object stored under \`ancestor_jsonpath\`. Note this when the persistence is the most informative signal ("travels in the saved \`order\` payload").
5. \`session_reads\` — places where the value is read out of session. Each entry shows the upstream \`origin_action\` and \`origin_path\` that wrote the data. Use this to phrase cross-step provenance ("seeded from the order persisted by select").
6. \`gated_writes\` — already a filtered shortlist of write sites with their gating predicate. If present, "info" should mention the gating condition exactly once.
7. \`cross_flow\` — boolean signals across flows. \`set_in_generate\` && \`asserted_in_validate\` ⇒ round-trip through the protocol; \`persisted_key\` with \`consumed_across_steps\` ⇒ stable session anchor across actions.
8. \`sample_values\` / \`most_common_value\` — illustrative only. Never the primary basis for "info".

────────────────────────────────────────
FORBIDDEN MOVES (each will fail review)
────────────────────────────────────────
- Do NOT restate the path. Bad: "context.transaction_id is the transaction_id under context."
- Do NOT include sample/example values in "info". Examples live in \`usage\`, derived elsewhere.
- Do NOT claim "required" or "optional". That's downstream.
- Do NOT invent constraints, formats, or relationships not present in the evidence.
- Do NOT write generic ONDC boilerplate ("This is part of the ONDC protocol…", "Used in ONDC transactions…"). Be specific about THIS attribute.
- Do NOT enumerate child fields when \`is_leaf\` is false. Describe the role of the container in one sentence.

────────────────────────────────────────
ENUM RULES (strict)
────────────────────────────────────────
- The ONLY authoritative source for \`enums\` is \`existing_enums\`. If non-empty, reuse its codes verbatim and in the same order. You MAY fill in an empty/placeholder \`description\` per entry, but never invent or rename codes.
- If \`existing_enums\` is empty or absent, DO NOT emit \`enums\`.

TAG RULES (ONDC-specific)
- If \`existing_tags\` is non-empty, preserve the codes and shape verbatim in your \`tags\` output. You MAY enrich each tag's \`_description.info\`. Never rename or drop tag codes.
- If \`existing_tags\` is empty/absent, do NOT fabricate tags.

────────────────────────────────────────
EXAMPLES of GOOD "info" (style + density)
────────────────────────────────────────
Path: context.transaction_id
Good info: "Stable identifier shared across every message of one ONDC transaction. The BAP mints it on the first request and every later request and response carries the same value so participants can correlate the chain."

Path: message.intent.category.id
Good info: "Domain-specific category code identifying which ONDC catalog branch the buyer is searching against. Sellers use it to filter their catalog before responding."

Path: message.order.fulfillments
Good info: "Ordered list of fulfillment plans the BPP intends to perform for this order, each describing a delivery, pickup, or service leg. Used by the BAP to display the fulfilment summary and to track state transitions."

Path: message.order.fulfillments.state.descriptor.code (enum)
Good info: "Lifecycle state of this fulfillment leg. The BPP advances the code as the leg progresses; the BAP uses it to drive the buyer-facing status display."

Path: message.order.items[*].price.value (gated write under tag descriptor TERM)
Good info: "Per-item rupee amount for the loan principal. The BPP rewrites this with the buyer's chosen request amount in select, and the value rides along when the saved order payload is replayed in confirm."

Path: message.order.tags[*].list[*].value (gated by descriptor.code === "TERM" inside LOAN_INFO)
Good info: "Loan term in months. Set on the LOAN_INFO/TERM cell of the items tag-list when the buyer picks an offer; the BPP reads it back to compute repayment schedules."

────────────────────────────────────────
OUTPUT
────────────────────────────────────────
Respond with a JSON array of EXACTLY ${inputs.length} objects, in the SAME ORDER as the input. Wrap the array in a \`\`\`json fenced block. No prose before or after.${correction}

INPUT:
${JSON.stringify(inputs, null, 2)}
`;
}

function parseDraftJson(raw: string, expected: number): LeafDraft[] {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = (fence ? fence[1] : raw).trim();
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new Error(
            `LLM did not return valid JSON. First 200 chars: ${raw.slice(0, 200).replace(/\s+/g, " ")}`,
        );
    }
    if (!Array.isArray(parsed)) {
        throw new Error("LLM response was not a JSON array");
    }
    if (parsed.length !== expected) {
        throw new Error(`LLM returned ${parsed.length} drafts; expected ${expected}`);
    }
    return parsed.map((p, i) => coerceLeaf(p, i));
}

/**
 * Re-anchor the LLM's output against existing_enums/tags we already know about.
 * This defends against the model dropping or renaming codes even when the
 * prompt tells it not to.
 */
function reconcileWithExisting(drafts: LeafDraft[], bundles: ContextBundle[]): LeafDraft[] {
    for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i]!;
        const existing = bundles[i]?.existing ?? null;
        if (!existing) continue;

        if (existing.enums && existing.enums.length > 0) {
            // Preserve existing codes/order; enrich description from LLM if the
            // LLM produced a matching entry with non-empty description.
            const llmByCode = new Map<string, EnumEntry>();
            for (const e of draft.enums ?? []) llmByCode.set(e.code, e);
            draft.enums = existing.enums.map((e) => {
                const match = llmByCode.get(e.code);
                return {
                    code: e.code,
                    description: (e.description || match?.description || "").trim(),
                    reference: e.reference || match?.reference || "",
                };
            });
            if (draft.type !== "enum") draft.type = "enum";
        }

        if (existing.tags && existing.tags.length > 0) {
            // Preserve existing tag codes/shape; enrich _description from LLM if available.
            const llmByCode = new Map<string, TagEntry>();
            for (const t of draft.tags ?? []) llmByCode.set(t.code, t);
            draft.tags = existing.tags.map((t) => {
                const match = llmByCode.get(t.code);
                return {
                    code: t.code,
                    _description: {
                        required: t._description.required,
                        usage: t._description.usage || match?._description.usage || "",
                        info: t._description.info || match?._description.info || "",
                        owner: t._description.owner || match?._description.owner || "unknown",
                        type: t._description.type || match?._description.type || "string",
                    },
                    list: t.list,
                };
            });
        }
    }
    return drafts;
}

function coerceLeaf(v: unknown, idx: number): LeafDraft {
    if (!v || typeof v !== "object") {
        throw new Error(`Draft ${idx} is not an object`);
    }
    const o = v as Record<string, unknown>;
    const required = typeof o["required"] === "boolean" ? o["required"] : true;
    const usage = String(o["usage"] ?? "");
    const info = String(o["info"] ?? "");
    const owner = String(o["owner"] ?? "unknown");
    const type = String(o["type"] ?? "string");
    const draft: LeafDraft = { required, usage, info, owner, type };
    if (Array.isArray(o["enums"])) {
        draft.enums = (o["enums"] as unknown[])
            .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
            .map((e) => ({
                code: String(e["code"] ?? ""),
                description: String(e["description"] ?? ""),
                reference: String(e["reference"] ?? ""),
            }));
    }
    if (Array.isArray(o["tags"])) {
        draft.tags = (o["tags"] as unknown[])
            .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
            .map((e) => {
                const desc = (e["_description"] ?? {}) as Record<string, unknown>;
                return {
                    code: String(e["code"] ?? ""),
                    _description: {
                        required: Boolean(desc["required"]),
                        usage: String(desc["usage"] ?? ""),
                        info: String(desc["info"] ?? ""),
                        owner: String(desc["owner"] ?? ""),
                        type: String(desc["type"] ?? "string"),
                    },
                };
            });
    }
    return draft;
}

function dummyDraft(b: ContextBundle, reason: string): LeafDraft {
    return {
        required: false,
        usage: "",
        info: `AUTO-FALLBACK (LLM failure: ${reason.slice(0, 80)}). Please edit in the review UI.`,
        owner: "unknown",
        type: b.obs.valueType === "object" ? "object" : "string",
    };
}
