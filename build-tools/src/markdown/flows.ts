import type { FlowEntry } from "../types/build-type.js";

function escapeCell(s: string): string {
    return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderFlowsIndex(flows: FlowEntry[]): string {
    const byUseCase = new Map<string, FlowEntry[]>();
    for (const flow of flows) {
        if (!byUseCase.has(flow.usecase)) byUseCase.set(flow.usecase, []);
        byUseCase.get(flow.usecase)!.push(flow);
    }

    const lines: string[] = [];
    lines.push(`# Flows`);
    lines.push(``);

    for (const [useCase, ucFlows] of byUseCase.entries()) {
        lines.push(`## ${useCase}`);
        lines.push(``);
        lines.push(`| Flow ID | Tags | Description |`);
        lines.push(`|---------|------|-------------|`);
        for (const flow of ucFlows) {
            const tags = flow.tags.join(", ");
            lines.push(`| [${flow.id}](${flow.id}.md) | ${escapeCell(tags)} | ${escapeCell(flow.description)} |`);
        }
        lines.push(``);
    }

    return lines.join("\n");
}

export function renderFlowPage(flow: FlowEntry): string {
    const lines: string[] = [];
    const cfg = flow.config as any;

    lines.push(`# Flow: ${flow.id}`);
    lines.push(``);
    lines.push(`**Use Case**: ${flow.usecase} | **Tags**: ${flow.tags.join(", ")}`);
    lines.push(``);
    lines.push(`**Description**: ${flow.description}`);
    lines.push(``);

    const steps: any[] = cfg.steps ?? [];

    if (steps.length > 0) {
        lines.push(`## Steps`);
        lines.push(``);
        lines.push(`| # | API | Action ID | Owner | Description |`);
        lines.push(`|---|-----|-----------|-------|-------------|`);
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            lines.push(
                `| ${i + 1} | \`${escapeCell(s.api)}\` | \`${escapeCell(s.action_id)}\` | ${escapeCell(s.owner)} | ${escapeCell(s.description ?? "")} |`,
            );
        }
        lines.push(``);

        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            lines.push(`### Step ${i + 1} — \`${s.api}\` (${s.owner})`);
            lines.push(``);

            const parts: string[] = [
                `**Action ID**: \`${s.action_id}\``,
                `**Response For**: ${s.responseFor ?? "—"}`,
                `**Unsolicited**: ${s.unsolicited ?? false}`,
            ];
            lines.push(parts.join(" | "));
            lines.push(``);

            if (s.description) {
                lines.push(s.description);
                lines.push(``);
            }

            const examples: any[] = s.examples ?? [];
            if (examples.length > 0) {
                lines.push(`#### Examples`);
                lines.push(``);
                for (const ex of examples) {
                    lines.push(`**${ex.name}**`);
                    lines.push(``);
                    if (ex.description) {
                        lines.push(ex.description);
                        lines.push(``);
                    }
                    lines.push("```json");
                    lines.push(JSON.stringify(ex.payload, null, 2));
                    lines.push("```");
                    lines.push(``);
                }
            }
        }
    }

    return lines.join("\n");
}
