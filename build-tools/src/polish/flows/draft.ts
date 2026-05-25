import type { ILLMProvider } from "../../knowledge-book/llm/types.js";
import type { PdfIndex } from "../context-pdfs/types.js";
import { formatExcerptBlock, retrieveExcerpts } from "../context-pdfs/retrieve.js";
import type { FlowStepRef, FlowLevelRef } from "./types.js";

export type StepDraftInput = {
    ref: FlowStepRef;
    attributeSubtree: unknown | null;
    flowDescription: string;
    pdfIndex?: PdfIndex;
};

export async function draftStepDescription(
    llm: ILLMProvider,
    input: StepDraftInput,
): Promise<string> {
    const prompt = buildStepPrompt(input);
    const raw = await llm.complete([{ role: "user", content: prompt }]);
    return normalize(raw);
}

export async function draftFlowDescription(
    llm: ILLMProvider,
    ref: FlowLevelRef,
    pdfIndex?: PdfIndex,
): Promise<string> {
    const prompt = buildFlowPrompt(ref, pdfIndex);
    const raw = await llm.complete([{ role: "user", content: prompt }]);
    return normalize(raw);
}

function buildStepPrompt(input: StepDraftInput): string {
    const { ref, attributeSubtree, flowDescription, pdfIndex } = input;
    const attrStr = attributeSubtree
        ? JSON.stringify(attributeSubtree, null, 2).slice(0, 4000)
        : "(no polished attributes available)";

    const pdfQuery = [ref.flowId, ref.usecase, ref.action, ref.owner, flowDescription]
        .filter(Boolean)
        .join(" ");
    const pdfBlock = formatExcerptBlock(retrieveExcerpts(pdfIndex, pdfQuery));

    return `You are an ONDC integration engineer writing a one-line description for a build-config flow step.

Context:
- Flow: "${ref.flowId}" (${ref.usecase}) — ${flowDescription || "(no description)"}
- Step ${ref.stepIndex}: api "${ref.action}", owner "${ref.owner}", responseFor "${ref.responseFor ?? "null"}", unsolicited ${ref.unsolicited}
- sessionData keys available from prior steps: ${ref.prevSaveDataKeys.length ? ref.prevSaveDataKeys.join(", ") : "(none)"}
- This step's saveData (JSONPath → session key): ${JSON.stringify(ref.saveData)}

Polished x-attributes subtree for action "${ref.action}":
${attrStr}
${pdfBlock ? "\n" + pdfBlock + "\n" : ""}
Task: Write a 1–2 sentence description of what this step represents in the transaction flow. State WHO acts (BAP / BPP) and WHAT the step conveys semantically. Use domain terms. Do not mention code, mocks, or implementation. Plain prose only — no headings, no lists, no quotes around the answer.

Respond with ONLY the description string. No JSON, no fences, no prose before or after.`;
}

function buildFlowPrompt(ref: FlowLevelRef, pdfIndex?: PdfIndex): string {
    const pdfQuery = [ref.flowId, ref.usecase, ref.currentDescription, ref.tags.join(" ")]
        .filter(Boolean)
        .join(" ");
    const pdfBlock = formatExcerptBlock(retrieveExcerpts(pdfIndex, pdfQuery));

    return `You are an ONDC integration engineer writing a one-line description for a transaction flow.

Context:
- Flow id: "${ref.flowId}" (usecase: ${ref.usecase})
- Tags: ${ref.tags.join(", ") || "(none)"}
- ${ref.stepCount} step(s), action sequence: ${ref.actionSummary.join(" → ") || "(none)"}
- Existing description (may be stub or empty): "${ref.currentDescription || "(empty)"}"
${pdfBlock ? "\n" + pdfBlock + "\n" : ""}
Task: Write a 1–2 sentence description of what this flow represents in the domain — the business scenario it exercises end-to-end. Use domain terms. No code or mock references. Plain prose only.

Respond with ONLY the description string. No JSON, no fences, no prose before or after.`;
}

function normalize(raw: string): string {
    let s = raw.trim();
    // Strip accidental fenced wrappers.
    const fenceMatch = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) s = fenceMatch[1]!.trim();
    // Strip surrounding quotes if the model wrapped the answer.
    if (
        (s.startsWith('"') && s.endsWith('"')) ||
        (s.startsWith("'") && s.endsWith("'"))
    ) {
        s = s.slice(1, -1).trim();
    }
    return s;
}
