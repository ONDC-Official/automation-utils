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
        const { drafts: batchDrafts } = await draftBatchWithRetry(llm, bundles, inputs, (ev) =>
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
            const infos = parseDraftText(raw, bundles.length);
            const drafts = infos.map((info, i) => buildDraftFromInfo(info, bundles[i]!));
            const reconciled = applyExisting(drafts, bundles);
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
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${retryReason}\nReturn EXACTLY ${inputs.length} blocks <<<1>>>..<<<${inputs.length}>>> in input order. Plain text, no JSON, no markdown, no code fences.`
        : "";

    return `You are an ONDC protocol documentation writer. Your audience is a partner integrator (BAP or BPP engineer) implementing this action for the first time. For each attribute, teach them what it means in the ONDC domain, what THIS action does with it, and any non-obvious constraint — anchored in the evidence provided.

────────────────────────────────────────
OUTPUT FORMAT
────────────────────────────────────────
For ${inputs.length} inputs, return EXACTLY ${inputs.length} blocks in input order:

<<<1>>>
<info text>
<<<2>>>
<info text>
...
<<<${inputs.length}>>>
<info text>

- Each block body: 1–2 sentences, ≤ 280 characters, no line breaks inside the body.
- Plain text only. NO JSON. NO markdown. NO surrounding quotes. NO code fences.
- No prose before <<<1>>>. No prose after the last block.
- If you have NO usable evidence for an input, leave that block body empty (just the marker line followed by a blank line).

You write ONLY the info string. enums, tags, type, required, usage, owner are filled in automatically by post-processing — do not produce them, do not reference them.

────────────────────────────────────────
ACTION-AWARE FRAMING (use the input's \`action\` field)
────────────────────────────────────────
- BAP-side actions (search, select, init, confirm, update, cancel, status, track, rating, support): the BAP writes the request. Describe what the BAP places here and why.
- BPP-side actions (on_search, on_select, on_init, on_confirm, on_update, on_cancel, on_status, on_track, on_rating, on_support): the BPP writes the response. Describe what the BPP returns and how the BAP consumes it.
- When \`cross_flow.set_in_generate && cross_flow.asserted_in_validate\`, name the round-trip explicitly (e.g. "BAP mints on init; BPP echoes in on_init").
- When \`cross_flow.persisted_key\` is set and \`consumed_across_steps\` is true, mention that the value is anchored in session and reused by later steps.

────────────────────────────────────────
CONTAINER RULE (when \`is_leaf\` is false)
────────────────────────────────────────
- Write ONE sentence about the role of the container in the message at this action.
- Do NOT enumerate child fields, list keys, or describe the schema shape.
- Do NOT invent purpose. If openapi and existing_leaf carry no description and refs only show structural traversal, return an empty body for that block.

────────────────────────────────────────
EVIDENCE PRECEDENCE — when sources conflict, the higher tier wins
────────────────────────────────────────
1. \`openapi.description\` / \`openapi.custom\` — authoritative ONDC spec text. Use first.
2. \`existing_leaf.info\` — prior curated text. If specific and correct, rephrase concisely. If generic, vague, ungrammatical, or contradicted by openapi, REWRITE rather than preserve.
3. \`referenced_in\` — code refs. \`role\` = read|write|delete; \`gated_by\` = the predicate gating the operation (e.g. \`tag.descriptor.code === "LOAN_INFO"\`). If \`gated_by\` is present, mention the gate exactly once.
4. \`save_data\` — \`inherited:true\` means the attribute travels inside an ancestor object stored under \`ancestor_jsonpath\`. Mention persistence only when it is the most informative signal.
5. \`session_reads\` — \`origin_action\` + \`origin_path\` show upstream provenance ("seeded from the order persisted by select").
6. \`gated_writes\` — derived shortlist of write sites with their gating predicate. Prefer over \`referenced_in\` when describing gating.
7. \`cross_flow\` — see ACTION-AWARE FRAMING above.
8. \`sample_values\` / \`most_common_value\` — illustrative only. NEVER the primary basis for info, and never quoted in the body.

If tiers 1–7 carry no signal, return an empty body.

────────────────────────────────────────
FORBIDDEN
────────────────────────────────────────
- Restating the path. Bad: "context.transaction_id is the transaction_id under context."
- Sample/example values inside the body.
- Claims about required/optional, type, or owner.
- Invented constraints, formats, or relationships not in the evidence.
- Generic ONDC boilerplate ("part of the ONDC protocol", "used in ONDC transactions"). Be specific about THIS attribute.
- Enumerating child fields when is_leaf is false.
- Producing enum codes, tag codes, or any structured list.

────────────────────────────────────────
EXAMPLES (input path → output body)
────────────────────────────────────────
context.transaction_id (action: search)
<<<i>>>
Stable identifier shared across every message of one ONDC transaction. The BAP mints it on the first request and every later request and response carries the same value so participants can correlate the chain.

message.intent.category.id (action: search)
<<<i>>>
Domain-specific category code identifying which ONDC catalog branch the buyer is searching against. Sellers use it to filter their catalog before responding.

message.order.fulfillments (action: on_confirm, is_leaf: false)
<<<i>>>
Ordered list of fulfillment plans the BPP intends to perform for this order, each describing a delivery, pickup, or service leg.

message.order.billing (action: init, is_leaf: false)
<<<i>>>
Buyer billing details the BAP submits so the BPP can issue an invoice; carried through to confirm and on_confirm unchanged.

message.order.fulfillments.state.descriptor.code (action: on_status, existing_enums present)
<<<i>>>
Lifecycle state of this fulfillment leg. The BPP advances the code as the leg progresses; the BAP uses it to drive the buyer-facing status display.

message.order.items.price.value (action: select, gated_by descriptor.code === "TERM" inside LOAN_INFO)
<<<i>>>
Per-item rupee amount for the loan principal. The BPP rewrites this with the buyer's chosen request amount in select, and the value rides along when the saved order payload is replayed in confirm.

message.order.tags.list.value (action: select, gated by descriptor.code === "TERM" inside LOAN_INFO)
<<<i>>>
Loan term in months. Set on the LOAN_INFO/TERM cell of the items tag-list when the buyer picks an offer; the BPP reads it back to compute repayment schedules.

────────────────────────────────────────
INPUT
────────────────────────────────────────
${JSON.stringify(inputs, null, 2)}

Now produce exactly ${inputs.length} blocks <<<1>>>..<<<${inputs.length}>>>.${correction}
`;
}

function parseDraftText(raw: string, expected: number): string[] {
    // Tolerate accidental code fences.
    const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const body = (fence ? fence[1] : raw).trim();
    const re = /<<<\s*(\d+)\s*>>>\s*([\s\S]*?)(?=<<<\s*\d+\s*>>>|$)/g;
    const blocks: { idx: number; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        blocks.push({ idx: parseInt(m[1]!, 10), text: m[2]!.trim() });
    }
    if (blocks.length !== expected) {
        throw new Error(
            `LLM returned ${blocks.length} blocks; expected ${expected}. First 200 chars: ${raw
                .slice(0, 200)
                .replace(/\s+/g, " ")}`,
        );
    }
    blocks.sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < expected; i++) {
        if (blocks[i]!.idx !== i + 1) {
            throw new Error(`Block index mismatch at position ${i}: got ${blocks[i]!.idx}`);
        }
    }
    return blocks.map((b) => b.text);
}

function deriveType(b: ContextBundle): string {
    const vt = b.obs.valueType;
    if (vt === "object" || vt === "array") return vt;
    return vt || "string";
}

function buildDraftFromInfo(info: string, b: ContextBundle): LeafDraft {
    return {
        required: false,
        usage: "",
        info: info.trim(),
        owner: "unknown",
        type: deriveType(b),
    };
}

/**
 * Overlay enums/tags from existing onto the draft. The LLM no longer produces
 * either — codes/shape come purely from existing.
 */
function applyExisting(drafts: LeafDraft[], bundles: ContextBundle[]): LeafDraft[] {
    for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i]!;
        const existing = bundles[i]?.existing ?? null;
        if (!existing) continue;

        if (existing.enums && existing.enums.length > 0) {
            draft.enums = existing.enums.map(
                (e): EnumEntry => ({
                    code: e.code,
                    description: (e.description || "").trim(),
                    reference: e.reference || "",
                }),
            );
            draft.type = "enum";
        }

        if (existing.tags && existing.tags.length > 0) {
            draft.tags = existing.tags.map(
                (t): TagEntry => ({
                    code: t.code,
                    _description: {
                        required: t._description.required,
                        usage: t._description.usage || "",
                        info: t._description.info || "",
                        owner: t._description.owner || "unknown",
                        type: t._description.type || "string",
                    },
                    list: t.list,
                }),
            );
        }
    }
    return drafts;
}

function dummyDraft(b: ContextBundle, reason: string): LeafDraft {
    return {
        required: false,
        usage: "",
        info: `AUTO-FALLBACK (LLM failure: ${reason.slice(0, 80)}). Please edit in the review UI.`,
        owner: "unknown",
        type: deriveType(b),
    };
}
