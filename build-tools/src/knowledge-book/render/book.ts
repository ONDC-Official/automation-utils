import type { KnowledgeBook } from "../types.js";
import { renderSection } from "./section.js";

export function renderBook(book: KnowledgeBook): Map<string, string> {
    const files = new Map<string, string>();

    for (const section of book.sections) {
        files.set(`${section.id}.md`, renderSection(section, book.generatedAt));
    }

    files.set("index.md", renderIndexPage(book));

    return files;
}

function renderIndexPage(book: KnowledgeBook): string {
    const { config, sections, generatedAt } = book;
    const { info } = config;
    const lines: string[] = [];

    lines.push(`<!-- knowledge-book:index generated="${generatedAt}" -->`);
    lines.push(``);
    lines.push(`# ${info.domain} ${info.version} — Knowledge Book`);
    lines.push(``);

    const meta = [`**Domain**: ${info.domain}`, `**Version**: ${info.version}`];
    if (info["x-branch-name"]) meta.push(`**Branch**: ${info["x-branch-name"]}`);
    lines.push(meta.join(" | "));
    lines.push(``);
    lines.push(`_Generated: ${generatedAt}_`);
    lines.push(``);
    lines.push(`## Contents`);
    lines.push(``);

    for (const section of sections) {
        lines.push(`- [${section.title}](./${section.id}.md)`);
    }
    lines.push(``);

    return lines.join("\n");
}
