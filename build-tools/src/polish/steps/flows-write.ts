import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { PolishStep } from "../types.js";
import type { ApprovedFlowDescs } from "./flows-review.js";

/**
 * Apply approved descriptions to:
 *  - <output>/flows/index.yaml — flow-level entry.description
 *  - <output>/flows/.../<flowId>.yaml — steps[idx].description
 *
 * No other fields are touched.
 */
export const flowsWriteStep: PolishStep = {
    id: "flows-write",
    title: "Write approved descriptions to flow files",
    async run(ctx) {
        const { ui } = ctx;
        const approved = ctx.state["approvedFlowDescs"] as ApprovedFlowDescs | undefined;
        if (!approved || (approved.flowLevel.size === 0 && approved.stepLevel.size === 0)) {
            ui.info("no approved descriptions — skipping write");
            return;
        }

        const flowsDir = join(ctx.outputDir, "flows");
        let flowsIndexUpdates = 0;
        let flowFileUpdates = 0;

        // ── flow-level: rewrite flows/index.yaml ────────────────────────────
        if (approved.flowLevel.size > 0) {
            const indexPath = join(flowsDir, "index.yaml");
            try {
                const raw = readFileSync(indexPath, "utf-8");
                const doc = parseYaml(raw) as
                    | { flows?: Array<{ id?: string; description?: string }> }
                    | Array<{ id?: string; description?: string }>;
                const list = Array.isArray(doc) ? doc : doc.flows ?? [];
                for (const entry of list) {
                    if (!entry.id) continue;
                    const draft = approved.flowLevel.get(entry.id);
                    if (draft?.description) {
                        entry.description = draft.description;
                        flowsIndexUpdates++;
                    }
                }
                writeFileSync(indexPath, stringifyYaml(doc, { lineWidth: 0 }), "utf-8");
                ui.path("flows index", indexPath);
            } catch (err) {
                ui.warn(
                    `could not update flows/index.yaml: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        // ── per-flow files: write step-level descriptions AND mirror the
        //    approved flow-level description into the file's meta.description.
        //    A flow YAML is opened if it has step approvals, flow-level
        //    approval, or both.
        const stepByFlow = new Map<string, Map<number, string>>();
        for (const [key, draft] of approved.stepLevel) {
            if (!draft.description) continue;
            const [flowId, idxStr] = key.split("::");
            const idx = Number(idxStr);
            if (!flowId || !Number.isFinite(idx)) continue;
            if (!stepByFlow.has(flowId)) stepByFlow.set(flowId, new Map());
            stepByFlow.get(flowId)!.set(idx, draft.description);
        }

        const flowIdsToWrite = new Set<string>([
            ...stepByFlow.keys(),
            ...Array.from(approved.flowLevel.keys()).filter(
                (id) => approved.flowLevel.get(id)?.description,
            ),
        ]);

        if (flowIdsToWrite.size > 0) {
            const fileByFlowId = resolveFlowFiles(flowsDir);
            for (const flowId of flowIdsToWrite) {
                const filePath = fileByFlowId.get(flowId);
                if (!filePath) {
                    ui.warn(`flow "${flowId}" not found under ${flowsDir} — skipping`);
                    continue;
                }
                const raw = readFileSync(filePath, "utf-8");
                const doc = parseYaml(raw) as {
                    meta?: { description?: string };
                    steps?: Array<{ description?: string }>;
                };

                let touched = false;

                const flowDesc = approved.flowLevel.get(flowId)?.description;
                if (flowDesc) {
                    if (!doc.meta) doc.meta = {};
                    doc.meta.description = flowDesc;
                    touched = true;
                }

                const descByIdx = stepByFlow.get(flowId);
                if (descByIdx) {
                    const steps = doc.steps ?? [];
                    for (const [idx, desc] of descByIdx) {
                        const s = steps[idx];
                        if (!s) continue;
                        s.description = desc;
                        touched = true;
                    }
                }

                if (!touched) continue;
                writeFileSync(filePath, stringifyYaml(doc, { lineWidth: 0 }), "utf-8");
                ui.path(flowId, filePath);
                flowFileUpdates++;
            }
        }

        ui.succeed(
            `updated ${flowsIndexUpdates} flow description(s) in index + ${flowFileUpdates} flow file(s) ` +
                `(${approved.flowLevel.size} flow-level + ${approved.stepLevel.size} step-level approvals)`,
        );
    },
};

function resolveFlowFiles(flowsDir: string): Map<string, string> {
    const out = new Map<string, string>();
    const indexPath = join(flowsDir, "index.yaml");
    try {
        const raw = readFileSync(indexPath, "utf-8");
        const doc = parseYaml(raw) as
            | { flows?: Array<{ id?: string; config?: { $ref?: string } }> }
            | Array<{ id?: string; config?: { $ref?: string } }>;
        const list = Array.isArray(doc) ? doc : doc.flows ?? [];
        for (const entry of list) {
            const id = entry.id;
            const ref = entry.config?.$ref;
            if (!id || !ref) continue;
            const abs = join(flowsDir, ref.startsWith("./") ? ref.slice(2) : ref);
            out.set(id, abs);
        }
    } catch {
        // fall through to tree scan
    }

    if (out.size === 0) {
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                const st = statSync(full);
                if (st.isDirectory()) walk(full);
                else if (full.endsWith(".yaml") && !full.endsWith("index.yaml")) {
                    try {
                        const doc = parseYaml(readFileSync(full, "utf-8")) as {
                            meta?: { flowId?: string };
                        };
                        const id = doc.meta?.flowId;
                        if (id) out.set(id, full);
                    } catch {
                        // skip
                    }
                }
            }
        };
        try {
            walk(flowsDir);
        } catch {
            // flowsDir missing
        }
    }
    return out;
}
