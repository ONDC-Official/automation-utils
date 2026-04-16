import type { BuildConfig } from "../types/build-type.js";

export function renderActionsPage(config: BuildConfig): string {
    const { supportedActions, apiProperties } = config["x-supported-actions"];
    const lines: string[] = [];

    lines.push(`# Supported Actions`);
    lines.push(``);

    lines.push(`## Action Flow`);
    lines.push(``);
    lines.push(`| Action | Next Actions |`);
    lines.push(`|--------|-------------|`);
    for (const [action, nextActions] of Object.entries(supportedActions)) {
        const next = nextActions.length > 0 ? nextActions.join(", ") : "—";
        lines.push(`| \`${action}\` | ${next} |`);
    }
    lines.push(``);

    lines.push(`## API Properties`);
    lines.push(``);
    lines.push(`| Action | Async Predecessor | Transaction Partners |`);
    lines.push(`|--------|------------------|----------------------|`);
    for (const [action, props] of Object.entries(apiProperties)) {
        const predecessor = props.async_predecessor ?? "—";
        const partners = props.transaction_partner.join(", ") || "—";
        lines.push(`| \`${action}\` | ${predecessor} | ${partners} |`);
    }
    lines.push(``);

    return lines.join("\n");
}
