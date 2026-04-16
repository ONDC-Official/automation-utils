import type { AttributeSet } from "../types/build-type.js";

interface FlatAttribute {
    path: string;
    required: boolean;
    type: string;
    owner: string;
    usage: string;
    info: string;
    enums?: { code: string; description: string; reference: string }[];
    enumrefs?: { label: string; href: string }[];
}

function isLeaf(v: unknown): boolean {
    return typeof v === "object" && v !== null && "required" in (v as object);
}

function flattenNode(node: unknown, path: string[]): FlatAttribute[] {
    if (isLeaf(node)) {
        const leaf = node as any;
        const result: FlatAttribute = {
            path: path.join("."),
            required: Boolean(leaf.required),
            type: String(leaf.type ?? "unknown"),
            owner: String(leaf.owner ?? "unknown"),
            usage: String(leaf.usage ?? "—"),
            info: String(leaf.info ?? "—"),
        };
        if (Array.isArray(leaf.enums) && leaf.enums.length > 0) {
            result.enums = leaf.enums;
        }
        if (Array.isArray(leaf.enumrefs) && leaf.enumrefs.length > 0) {
            result.enumrefs = leaf.enumrefs;
        }
        return [result];
    }

    if (typeof node === "object" && node !== null) {
        return Object.entries(node as Record<string, unknown>).flatMap(([key, val]) =>
            flattenNode(val, [...path, key]),
        );
    }

    return [];
}

function escapeCell(s: string): string {
    return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderAttributesPage(attrSet: AttributeSet): string {
    const useCase = attrSet.meta?.use_case_id ?? "unknown";
    const lines: string[] = [];

    lines.push(`# Attributes — ${useCase}`);
    lines.push(``);

    const attrSetData = attrSet.attribute_set;
    if (!attrSetData || Object.keys(attrSetData).length === 0) {
        lines.push(`_No attributes defined for this use case._`);
        lines.push(``);
        return lines.join("\n");
    }

    for (const [action, actionNode] of Object.entries(attrSetData)) {
        const flatAttrs = flattenNode(actionNode, []);
        if (flatAttrs.length === 0) continue;

        lines.push(`## ${action}`);
        lines.push(``);
        lines.push(`| Path | Required | Type | Owner | Usage | Info |`);
        lines.push(`|------|----------|------|-------|-------|------|`);

        for (const attr of flatAttrs) {
            const req = attr.required ? "✓" : "✗";
            lines.push(
                `| \`${escapeCell(attr.path)}\` | ${req} | ${escapeCell(attr.type)} | ${escapeCell(attr.owner)} | ${escapeCell(attr.usage)} | ${escapeCell(attr.info)} |`,
            );
        }
        lines.push(``);

        const withEnums = flatAttrs.filter((a) => a.enums && a.enums.length > 0);
        for (const attr of withEnums) {
            lines.push(`### Enums: \`${attr.path}\``);
            lines.push(``);
            lines.push(`| Code | Description | Reference |`);
            lines.push(`|------|-------------|-----------|`);
            for (const e of attr.enums!) {
                lines.push(
                    `| ${escapeCell(e.code)} | ${escapeCell(e.description)} | ${escapeCell(e.reference)} |`,
                );
            }
            lines.push(``);
        }

        const withEnumrefs = flatAttrs.filter((a) => a.enumrefs && a.enumrefs.length > 0);
        for (const attr of withEnumrefs) {
            lines.push(`### Enum References: \`${attr.path}\``);
            lines.push(``);
            lines.push(`| Label | Link |`);
            lines.push(`|-------|------|`);
            for (const ref of attr.enumrefs!) {
                lines.push(`| ${escapeCell(ref.label)} | ${escapeCell(ref.href)} |`);
            }
            lines.push(``);
        }
    }

    return lines.join("\n");
}
