import type { ILLMProvider } from "../../knowledge-book/llm/types.js";
import type { ContextBundle, EnumEntry, LeafDraft, TagEntry } from "./types.js";

const RETRY_ATTEMPTS = 1;

export type BatchEvent =
    | { kind: "start" }
    | { kind: "ok"; attempt: number; elapsedMs: number }
    | { kind: "retry"; attempt: number; reason: string }
    | { kind: "fallback"; reason: string };

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
    for (const item of items) {
        const draft = await draftOneWithRetry(llm, item, onEvent);
        drafts.push(draft);
    }
    return drafts;
}

async function draftOneWithRetry(
    llm: ILLMProvider,
    item: DraftItem,
    onEvent?: BatchEventHandler,
): Promise<LeafDraft> {
    onEvent?.({ kind: "start" });
    const input = itemToLLMInput(item);
    const bundle = item.bundle;
    let lastReason = "";
    for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
        const started = Date.now();
        const prompt = buildPrompt([input], attempt > 0 ? lastReason : "");
        try {
            const raw = await llm.complete([{ role: "user", content: prompt }]);
            const info = parseDraftText(raw);
            const draft = applyExisting([buildDraftFromInfo(info, bundle)], [bundle])[0]!;
            onEvent?.({ kind: "ok", attempt, elapsedMs: Date.now() - started });
            return draft;
        } catch (err) {
            lastReason = err instanceof Error ? err.message : String(err);
            if (attempt < RETRY_ATTEMPTS) {
                onEvent?.({ kind: "retry", attempt: attempt + 1, reason: lastReason });
                continue;
            }
            onEvent?.({ kind: "fallback", reason: lastReason });
            return dummyDraft(bundle, lastReason);
        }
    }
    return dummyDraft(bundle, lastReason);
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
    const input = inputs[0]!;
    const correction = retryReason
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${retryReason}\nReturn plain text only — no JSON, no markdown, no code fences, no quoting.`
        : "";

    return `You are an ONDC protocol documentation writer. Your audience is a partner integrator (BAP or BPP engineer) implementing this action for the first time. Teach them what this attribute means in the ONDC domain, what THIS action does with it, and any non-obvious constraint — anchored in the evidence provided.

OUTPUT
- Plain text only. NO JSON, NO markdown, NO code fences, NO surrounding quotes.
- Preferred 1–2 sentences; up to 7 sentences if the evidence genuinely warrants more detail.
- Output ONLY the description text — no preamble, no labels, no path restatement.
- If tiers 1–7 carry no signal, output EXACTLY the literal token: <no-enough-data> — nothing else, no quotes, no preamble, no explanation.
- You write ONLY the info string. enums, tags, type, required, usage, owner are filled in automatically — do not produce them.

ACTION-AWARE FRAMING (use the \`action\` field)
- BAP-side actions (search, select, init, confirm, update, cancel, status, track, rating, support): BAP writes the request — describe what the BAP places here and why.
- BPP-side actions (on_search, on_select, on_init, on_confirm, on_update, on_cancel, on_status, on_track, on_rating, on_support): BPP writes the response — describe what the BPP returns and how the BAP consumes it.
- When \`cross_flow.set_in_generate && cross_flow.asserted_in_validate\`, name the round-trip (e.g. "BAP mints on init; BPP echoes in on_init").
- When \`cross_flow.persisted_key\` is set and \`consumed_across_steps\` is true, mention that the value is anchored in session and reused by later steps.

CONTAINER RULE (when \`is_leaf\` is false)
- Write ONE sentence about the role of the container in the message at this action. Do NOT enumerate child fields or describe the schema shape. If openapi and existing_leaf carry no description and refs only show structural traversal, return empty.

EVIDENCE PRECEDENCE (higher tier wins on conflict)
1. \`openapi.description\` / \`openapi.custom\` — authoritative ONDC spec text.
2. \`existing_leaf.info\` — prior curated text. Rephrase if good; rewrite if generic/vague/contradicted.
3. \`referenced_in\` — code refs. \`role\` = read|write|delete; \`gated_by\` = the predicate gating the operation. If \`gated_by\` present, mention the gate once.
4. \`save_data\` — \`inherited:true\` means the attribute travels inside an ancestor stored under \`ancestor_jsonpath\`. Mention persistence only when it is the most informative signal.
5. \`session_reads\` — \`origin_action\` + \`origin_path\` show upstream provenance.
6. \`gated_writes\` — derived shortlist of write sites with gating predicate; prefer over raw \`referenced_in\` when describing gating.
7. \`cross_flow\` — see ACTION-AWARE FRAMING.
8. \`sample_values\` / \`most_common_value\` — illustrative only, never primary basis, never quoted.

If tiers 1–7 carry no signal, output EXACTLY <no-enough-data>.

FORBIDDEN
- Restating the path.
- Quoting sample/example values.
- Claims about required/optional, type, or owner.
- Invented constraints, formats, or relationships not in the evidence.
- Generic ONDC boilerplate ("part of the ONDC protocol"). Be specific about THIS attribute.
- Enumerating child fields when is_leaf is false.
- Producing enum codes, tag codes, or any structured list.
- Substituting any alternative phrasing for <no-enough-data> (e.g. "I don't have enough data", empty string, "no data available", "insufficient evidence"). Use the EXACT token <no-enough-data> and nothing else when evidence is missing.

EXAMPLES (input → output)
context.transaction_id (action: search)
Stable identifier shared across every message of one ONDC transaction. The BAP mints it on the first request and every later request and response carries the same value so participants can correlate the chain.

message.order.fulfillments (action: on_confirm, is_leaf: false)
Ordered list of fulfillment plans the BPP intends to perform for this order, each describing a delivery, pickup, or service leg.

message.order.items.price.value (action: select, gated_by descriptor.code === "TERM" inside LOAN_INFO)
Per-item rupee amount for the loan principal. The BPP rewrites this with the buyer's chosen request amount in select, and the value rides along when the saved order payload is replayed in confirm.

INPUT
${JSON.stringify(input, null, 2)}

Now produce the description.${correction}
`;
}

export const NO_DATA_SENTINEL = "<no-enough-data>";

function parseDraftText(raw: string): string {
    // Tolerate accidental code fences.
    const fence = raw.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const body = (fence ? fence[1]! : raw).trim();
    // Strip surrounding quotes if the model added them.
    const dequoted = body.replace(/^["'`]|["'`]$/g, "").trim();
    if (dequoted === NO_DATA_SENTINEL) return NO_DATA_SENTINEL;
    return dequoted;
}

export async function paraphraseUserDescription(
    llm: ILLMProvider,
    args: { path: string; action: string; userText: string },
): Promise<string> {
    const prompt = `You are an ONDC protocol documentation writer.
Rewrite the developer's note below into a 1–2 sentence ONDC-style description for attribute "${args.path}" in action "${args.action}".

ACTION-AWARE FRAMING
- BAP-side actions (search, select, init, confirm, update, cancel, status, track, rating, support): BAP writes the request — describe what the BAP places here and why.
- BPP-side actions (on_search, on_select, on_init, on_confirm, on_update, on_cancel, on_status, on_track, on_rating, on_support): BPP writes the response, BAP consumes.

OUTPUT
- Plain text only. NO JSON, markdown, code fences, or surrounding quotes.
- 1–2 sentences. Specific to THIS attribute. No path restatement, no boilerplate, no preamble.

DEVELOPER NOTE
${args.userText}

Now produce the description.`;
    const raw = await llm.complete([{ role: "user", content: prompt }]);
    return parseDraftText(raw);
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
