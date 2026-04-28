import type { KnowledgeSection } from "../types.js";

export function renderSection(section: KnowledgeSection, generatedAt: string): string {
    const lines: string[] = [];
    lines.push(`<!-- knowledge-book:section id="${section.id}" generated="${generatedAt}" -->`);
    lines.push(``);
    lines.push(section.markdown.trimEnd());
    lines.push(``);
    return lines.join("\n");
}
