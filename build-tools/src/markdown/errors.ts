import type { BuildConfig } from "../types/build-type.js";

function escapeCell(s: string): string {
    return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderErrorsPage(config: BuildConfig): string {
    const codes = config["x-errorcodes"].code;
    const lines: string[] = [];

    lines.push(`# Error Codes`);
    lines.push(``);

    if (codes.length === 0) {
        lines.push(`_No error codes defined._`);
        lines.push(``);
        return lines.join("\n");
    }

    const sorted = [...codes].sort((a, b) => String(a.code).localeCompare(String(b.code)));

    lines.push(`| Code | Event | From | Description |`);
    lines.push(`|------|-------|------|-------------|`);
    for (const entry of sorted) {
        lines.push(
            `| \`${escapeCell(String(entry.code))}\` | ${escapeCell(entry.Event)} | ${escapeCell(entry.From)} | ${escapeCell(entry.Description)} |`,
        );
    }
    lines.push(``);

    return lines.join("\n");
}
