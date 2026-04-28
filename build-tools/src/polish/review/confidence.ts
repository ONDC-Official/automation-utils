import type { ContextBundle, LeafDraft, ConfidenceScore } from "../attributes/types.js";
import type { FlowConfidenceScore } from "../flows/types.js";
import type { FlowDescDraft } from "../steps/flows-draft.js";

export const DEFAULT_THRESHOLD = 0.8;

export function getConfidenceThreshold(): number {
    const raw = process.env["POLISH_CONFIDENCE"];
    if (!raw) return DEFAULT_THRESHOLD;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_THRESHOLD;
    return n;
}

function clamp01(n: number): number {
    if (n < 0) return 0;
    if (n > 1) return 1;
    return Math.round(n * 1000) / 1000;
}

function sum(factors: Record<string, number>): number {
    let s = 0;
    for (const v of Object.values(factors)) s += v;
    return s;
}

export function scoreAttributeDraft(
    bundle: ContextBundle,
    draft: LeafDraft,
): ConfidenceScore {
    const factors: Record<string, number> = {};

    // LLM fallback drafts are never trustworthy.
    if (draft.info.startsWith("AUTO-FALLBACK")) {
        return { score: 0, factors: { fallback: 0 } };
    }

    const o = bundle.openapi;
    if (o?.description && o.description.trim().length > 0) {
        factors["openapi_description"] = 0.25;
    }
    if (o?.customDescription && Object.keys(o.customDescription).length > 0) {
        factors["openapi_custom_description"] = 0.15;
    }

    // Enums: trust comes from the existing attribute set carrying them forward,
    // not from OpenAPI (which is unreliable for enum values in this repo).
    if (bundle.existing?.enums?.length && draft.enums?.length) {
        factors["enums_carried_forward"] = 0.15;
    }
    // Tags carried forward from existing x-attributes — strong signal.
    if (bundle.existing?.tags?.length && draft.tags?.length) {
        factors["tags_carried_forward"] = 0.15;
    }

    if (bundle.refs.length >= 3) {
        factors["refs_strong"] = 0.2;
    } else if (bundle.refs.length > 0) {
        factors["refs_weak"] = Math.min(0.15, bundle.refs.length * 0.05);
    }

    if (bundle.saveData.length >= 1) {
        factors["save_data"] = 0.1;
    }

    if (bundle.obs.sampleValues.length >= 3) {
        factors["sample_variety"] = 0.1;
    }

    const cf = bundle.crossFlow;
    if (cf) {
        if (cf.setInGenerate && cf.assertedInValidate) {
            factors["cross_flow_round_trip"] = 0.1;
        }
        if (cf.persistedKey && cf.consumedAcrossSteps) {
            factors["cross_flow_persisted"] = 0.05;
        }
    }

    if (draft.info && draft.info.length >= 80) {
        factors["info_depth"] = 0.1;
    }

    if (draft.info && infoAnchoredInEvidence(draft.info, bundle)) {
        factors["info_evidence_anchored"] = 0.05;
    }

    return { score: clamp01(sum(factors)), factors };
}

const STOPWORDS = new Set([
    "the","a","an","of","to","in","for","and","or","with","is","are","this","that",
    "be","by","from","as","on","it","at","its","into","when","then","than",
]);

function tokenize(s: string): string[] {
    return s
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function infoAnchoredInEvidence(info: string, bundle: ContextBundle): boolean {
    const evidenceParts: string[] = [];
    if (bundle.openapi?.description) evidenceParts.push(bundle.openapi.description);
    if (bundle.openapi?.customDescription) {
        evidenceParts.push(JSON.stringify(bundle.openapi.customDescription));
    }
    const leaf = bundle.existing?.leaf;
    if (leaf) {
        if (typeof (leaf as { info?: unknown }).info === "string") {
            evidenceParts.push((leaf as { info: string }).info);
        } else {
            evidenceParts.push(JSON.stringify(leaf));
        }
    }
    if (evidenceParts.length === 0) return false;

    const evidence = evidenceParts.join(" ");
    const evidenceTokens = new Set(tokenize(evidence));
    if (evidenceTokens.size === 0) return false;

    const infoTokens = tokenize(info);
    let hits = 0;
    for (const t of infoTokens) {
        if (evidenceTokens.has(t)) {
            hits++;
            if (hits >= 2) return true;
        }
    }
    return false;
}

/**
 * Score a drafted flow or step description. Description-only scope, so the
 * factors are intentionally few: shape of the text, presence of contextual
 * signals the drafter had available, and drafter-error propagation.
 */
export function scoreFlowDescription(d: FlowDescDraft): FlowConfidenceScore {
    const factors: Record<string, number> = {};
    if (d.error) {
        return { score: 0, factors: { error: 0 } };
    }
    const text = (d.description ?? "").trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (text.length >= 60) factors["length_depth"] = 0.3;
    else if (text.length >= 30) factors["length_basic"] = 0.2;

    if (wordCount >= 10) factors["word_count"] = 0.1;

    // Rough "sounds like a sentence" check — starts with capital, ends with
    // punctuation. Cheap quality signal.
    if (/^[A-Z]/.test(text)) factors["starts_cap"] = 0.05;
    if (/[.!?]$/.test(text)) factors["ends_punct"] = 0.05;

    // Domain cues from the ref — more context = more trust.
    if (d.kind === "step") {
        if (Object.keys(d.ref.saveData ?? {}).length >= 1) factors["step_savedata"] = 0.15;
        if (d.ref.prevSaveDataKeys.length >= 1) factors["step_prev_session"] = 0.1;
        if (d.ref.owner && d.ref.owner !== "unknown") factors["step_owner_known"] = 0.1;
    } else {
        if (d.ref.tags.length >= 1) factors["flow_tags"] = 0.15;
        if (d.ref.actionSummary.length >= 3) factors["flow_has_shape"] = 0.15;
    }

    return { score: clamp01(sum(factors)), factors };
}
