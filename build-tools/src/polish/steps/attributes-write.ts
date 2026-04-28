import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { stringify as stringifyYaml } from "yaml";
import type { PolishStep } from "../types.js";
import type { LeafDraft, LeafObservation } from "../attributes/types.js";
import { mergeDraftsIntoAttributeSet } from "../attributes/merge-edits.js";
import type { AttributeSet } from "../../types/build-type.js";

export const attributesWriteStep: PolishStep = {
    id: "attributes-write",
    title: "Write polished per-usecase attribute files",
    async run(ctx) {
        const { ui } = ctx;
        const approved = ctx.state["approvedDrafts"] as Map<string, LeafDraft> | undefined;
        const observations = ctx.state["attributeObservations"] as LeafObservation[] | undefined;
        if (!approved || approved.size === 0 || !observations) {
            ui.info("no approved drafts — skipping write");
            return;
        }

        ui.spin("merging drafts into attribute sets");
        const existingSets = ctx.config["x-attributes"] ?? [];
        const obsByUc = new Map<string, LeafObservation[]>();
        for (const o of observations) {
            if (!obsByUc.has(o.ucId)) obsByUc.set(o.ucId, []);
            obsByUc.get(o.ucId)!.push(o);
        }

        const attrDir = join(ctx.outputDir, "attributes");
        mkdirSync(attrDir, { recursive: true });

        const indexEntries: Array<{ $ref: string }> = [];

        const allUsecases = new Set<string>();
        for (const uc of obsByUc.keys()) allUsecases.add(uc);
        for (const s of existingSets) {
            if (s.meta?.use_case_id) allUsecases.add(s.meta.use_case_id);
        }

        for (const ucId of allUsecases) {
            const existing = existingSets.find((s) => s.meta?.use_case_id === ucId);
            const obs = obsByUc.get(ucId) ?? [];

            const ucDrafts = new Map<string, LeafDraft>();
            for (const [key, draft] of approved) {
                const [keyUc, rest] = splitFirst(key, "::");
                if (keyUc === ucId) ucDrafts.set(rest, draft);
            }

            const set: AttributeSet = mergeDraftsIntoAttributeSet(existing, ucId, obs, ucDrafts);

            const fileSlug = slugifyFile(ucId);
            const fileName = `${fileSlug}.yaml`;
            const filePath = join(attrDir, fileName);
            writeFileSync(filePath, stringifyYaml(set, { lineWidth: 0 }), "utf-8");
            indexEntries.push({ $ref: `./${fileName}` });
            ui.path(fileSlug, filePath);
        }

        const indexPath = join(attrDir, "index.yaml");
        writeFileSync(indexPath, stringifyYaml(indexEntries, { lineWidth: 0 }), "utf-8");
        ui.succeed(`wrote ${allUsecases.size} usecase file(s) + index`);
    },
};

function splitFirst(s: string, sep: string): [string, string] {
    const i = s.indexOf(sep);
    if (i < 0) return [s, ""];
    return [s.slice(0, i), s.slice(i + sep.length)];
}

function slugifyFile(s: string): string {
    return s.replace(/[^\w]+/g, "_");
}
