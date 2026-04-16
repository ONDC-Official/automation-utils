import type { BuildConfig } from "../types/build-type.js";

export function renderIndexPage(config: BuildConfig, docFiles: string[]): string {
    const { info } = config;
    const lines: string[] = [];

    lines.push(`# ${info.domain} ${info.version}`);
    lines.push(``);

    const meta: string[] = [`**Domain**: ${info.domain}`, `**Version**: ${info.version}`];
    if (info["x-branch-name"]) meta.push(`**Branch**: ${info["x-branch-name"]}`);
    meta.push(`**Reporting**: ${info["x-reporting"]}`);
    lines.push(meta.join(" | "));
    lines.push(``);

    if (info.description) {
        lines.push(`> ${info.description}`);
        lines.push(``);
    }

    if (info["x-usecases"].length > 0) {
        lines.push(`## Use Cases`);
        lines.push(``);
        for (const uc of info["x-usecases"]) {
            lines.push(`- ${uc}`);
        }
        lines.push(``);
    }

    lines.push(`## Contents`);
    lines.push(``);
    lines.push(`- [Flows](flows/index.md)`);
    lines.push(`- [Attributes](attributes/)`);
    lines.push(`- [Error Codes](errors.md)`);
    lines.push(`- [Supported Actions](actions.md)`);

    for (const docFile of docFiles) {
        const stem = docFile.replace(/\.md$/, "");
        const label = stem
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        lines.push(`- [${label}](${docFile})`);
    }

    lines.push(``);
    return lines.join("\n");
}
