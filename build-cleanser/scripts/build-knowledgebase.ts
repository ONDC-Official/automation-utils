/**
 * build-knowledgebase.ts
 *
 * Usage:
 *   npx tsx scripts/build-knowledgebase.ts <new-build.yaml> [knowledgebase.json]
 *
 * Reads every _description leaf inside x-attributes of a new-format YAML and
 * upserts entries into knowledgebase.json with keys of the form:
 *
 *   {domain}.{version}.{action}.{dotted.attribute.path}
 *
 * The value stored is the `info` string from the _description leaf.
 * Existing keys are NOT overwritten — the file is only ever appended to so
 * entries from multiple domains/versions accumulate over time.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { parse } from "yaml";
import type { KnowledgeBaseEntry } from "../services/knowledgebase.js";
import type {
    NewBuildType,
    NewAttributeValue,
    NewAttributeLeaf,
} from "../types/new-build.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type KnowledgeBase = Record<string, KnowledgeBaseEntry>;

// ─── Guards ──────────────────────────────────────────────────────────────────

function isLeaf(v: NewAttributeValue): v is NewAttributeLeaf {
    return (
        typeof v === "object" &&
        v !== null &&
        "info" in v &&
        typeof (v as Record<string, unknown>)["info"] === "string"
    );
}

// ─── Core walker ─────────────────────────────────────────────────────────────

function walkNode(
    node: NewAttributeValue,
    pathParts: string[],
    prefix: string,
    kb: KnowledgeBase,
): void {
    if (isLeaf(node)) {
        const key = `${prefix}.${pathParts.join(".")}`;
        // Only add if not already present — never overwrite existing knowledge
        if (!(key in kb)) {
            const entry: KnowledgeBaseEntry = { info: node.info };
            // if (node.type !== undefined) entry.type = node.type;
            // if (node.owner !== undefined) entry.owner = node.owner;
            // if (node.required !== undefined) entry.required = node.required;
            // if (node.usage !== undefined) entry.usage = node.usage;
            kb[key] = entry;
        }
        return;
    }

    const container = node as Record<string, NewAttributeValue | undefined>;
    for (const key of Object.keys(container)) {
        const child = container[key];
        if (child == null || typeof child !== "object") continue;

        if (key === "_description") {
            // _description is the leaf for the current path (not a deeper segment)
            walkNode(child as NewAttributeValue, pathParts, prefix, kb);
        } else {
            walkNode(
                child as NewAttributeValue,
                [...pathParts, key],
                prefix,
                kb,
            );
        }
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
    const [, , inputPath, kbPath = "knowledgebase.json"] = process.argv;

    if (!inputPath) {
        console.error(
            "Usage: npx tsx scripts/build-knowledgebase.ts <new-build.yaml> [knowledgebase.json]",
        );
        process.exit(1);
    }

    // Load existing knowledgebase (or start fresh)
    // Migrate any legacy string values to objects
    const rawKb = existsSync(kbPath)
        ? (JSON.parse(readFileSync(kbPath, "utf-8")) as Record<string, unknown>)
        : {};
    const kb: KnowledgeBase = Object.fromEntries(
        Object.entries(rawKb).map(([k, v]) => [
            k,
            typeof v === "string" ? { info: v } : (v as KnowledgeBaseEntry),
        ]),
    );

    const before = Object.keys(kb).length;

    // Parse input YAML
    const doc = parse(readFileSync(inputPath, "utf-8")) as NewBuildType;

    const domain: string = doc.info?.domain ?? doc.info?.title ?? "unknown";
    const version: string = doc.info?.version ?? "unknown";
    const prefix = `${domain}.${version}`;

    const xAttributes = doc["x-attributes"];
    if (!Array.isArray(xAttributes) || xAttributes.length === 0) {
        console.warn("No x-attributes found in the provided YAML.");
    } else {
        for (const entry of xAttributes) {
            const attributeSet = entry.attribute_set;
            if (!attributeSet) continue;

            for (const action of Object.keys(attributeSet)) {
                const actionNode = attributeSet[action];
                if (!actionNode || typeof actionNode !== "object") continue;

                walkNode(actionNode as NewAttributeValue, [action], prefix, kb);
            }
        }
    }

    const after = Object.keys(kb).length;

    // Write back sorted for stable diffs
    const sorted: KnowledgeBase = Object.fromEntries(
        Object.entries(kb).sort(([a], [b]) => a.localeCompare(b)),
    ) as KnowledgeBase;
    writeFileSync(kbPath, JSON.stringify(sorted, null, 2), "utf-8");

    console.log(
        `Done.  Added ${after - before} new entries (${after} total) → ${kbPath}`,
    );
}

main();
