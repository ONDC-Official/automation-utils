import { existsSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import chalk from "chalk";
import { BuildConfig } from "../types/build-type.js";
import { loadSplitConfig } from "./merge.js";
import { createLLMProvider } from "../knowledge-book/llm/factory.js";
import { POLISH_PIPELINE } from "../polish/pipeline.js";
import type { PolishContext } from "../polish/types.js";
import { ConsoleUI } from "../polish/ui.js";

interface PolishOptions {
    input: string;
    output: string;
    phase?: string;
    provider?: string;
    model?: string;
    apiKey?: string;
}

export function createPolishCommand(): Command {
    return new Command("polish")
        .description(
            "Raise a split-config to gold standard. Runs phased pipeline steps " +
                "(overview → attributes → flows) and writes a new split-config directory.",
        )
        .requiredOption(
            "-i, --input <path>",
            "Path to input split-config directory (containing index.yaml)",
        )
        .requiredOption("-o, --output <path>", "Path to output split-config directory")
        .option(
            "--phase <name>",
            "Run only a specific phase: overview | attributes | flows | all",
            "all",
        )
        .option("--provider <name>", "LLM provider — overrides AI_TYPE env var")
        .option("--model <model>", "Model name — overrides AI_MODEL env var")
        .option("--api-key <key>", "API key — overrides AI_API_KEY env var")
        .action(async (opts: PolishOptions) => {
            const ui = new ConsoleUI();
            const inputDir = resolve(opts.input);
            const outputDir = resolve(opts.output);

            if (!existsSync(inputDir)) {
                console.error(chalk.red(`\n  error: input directory not found: ${inputDir}\n`));
                process.exit(1);
            }

            let merged: unknown;
            try {
                merged = loadSplitConfig(inputDir);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(chalk.red(`\n  error: cannot load split config: ${msg}\n`));
                process.exit(1);
            }

            const parsed = BuildConfig.safeParse(merged);
            if (!parsed.success) {
                console.error(
                    chalk.red(
                        `\n  error: merged config failed schema validation — run \`validate\` for details\n`,
                    ),
                );
                process.exit(1);
            }
            const config = parsed.data;

            const provider = opts.provider ?? process.env["AI_TYPE"] ?? "anthropic";
            const apiKey = opts.apiKey ?? process.env["AI_API_KEY"];
            const model = opts.model ?? process.env["AI_MODEL"] ?? "claude-haiku-4-5-20251001";

            if (!apiKey) {
                console.error(
                    chalk.red(`\n  error: no API key — set AI_API_KEY or pass --api-key\n`),
                );
                process.exit(1);
            }
            if (provider !== "anthropic" && provider !== "openai-compat") {
                console.error(
                    chalk.red(
                        `\n  error: unknown provider "${provider}" — expected anthropic or openai-compat\n`,
                    ),
                );
                process.exit(1);
            }

            const baseUrl = process.env["AI_BASE_URL"] ?? "https://api.ollama.com/v1";
            const llm = createLLMProvider(
                provider === "openai-compat"
                    ? { provider: "openai-compat", model, apiKey, baseUrl }
                    : { provider: "anthropic", model, apiKey },
            );

            const phaseFilter = (opts.phase ?? "all").toLowerCase();
            const attrLimit = process.env["POLISH_ATTR_LIMIT"];
            const flowLimit = process.env["POLISH_FLOW_LIMIT"];

            const limits = [
                attrLimit ? `POLISH_ATTR_LIMIT=${attrLimit}` : null,
                flowLimit ? `POLISH_FLOW_LIMIT=${flowLimit}` : null,
            ]
                .filter(Boolean)
                .join(" · ");

            ui.banner(`Polish — ${config.info.domain} ${config.info.version}`, {
                input: inputDir,
                output: outputDir,
                phase: phaseFilter,
                provider,
                model,
                ...(limits ? { testMode: limits } : {}),
            });

            ui.spin(`checking LLM connection (${provider} / ${model})`);
            try {
                await llm.ping();
                ui.succeed("LLM reachable");
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                ui.fail(`LLM preflight failed: ${msg}`);
                console.error(
                    chalk.dim(
                        `\n  Hint: check AI_API_KEY, AI_BASE_URL, and AI_MODEL in your .env\n`,
                    ),
                );
                process.exit(1);
            }

            const ctx: PolishContext = { inputDir, outputDir, config, llm, ui, state: {} };
            const activeSteps = POLISH_PIPELINE.filter((s) =>
                shouldRunStep(s.id, phaseFilter),
            );

            for (let i = 0; i < activeSteps.length; i++) {
                const step = activeSteps[i]!;
                ui.beginStep(step.id, step.title, i + 1, activeSteps.length);
                try {
                    await step.run(ctx);
                    ui.endStep(true);
                } catch (err) {
                    ui.endStep(false);
                    const msg = err instanceof Error ? err.message : String(err);
                    console.error(chalk.red(`\n  error: step "${step.id}" failed: ${msg}\n`));
                    if (err instanceof Error && err.stack) console.error(chalk.dim(err.stack));
                    process.exit(1);
                }
            }

            console.log(
                "\n" +
                    chalk.green.bold("  ✓ Polish complete.") +
                    " " +
                    chalk.dim(`Run \`parse -i ${outputDir} -o build.yaml\` next.\n`),
            );
        });
}

function shouldRunStep(stepId: string, phaseFilter: string): boolean {
    if (phaseFilter === "all") return true;
    if (stepId === "scaffold") return true;
    if (phaseFilter === "overview" && stepId.startsWith("overview-")) return true;
    if (phaseFilter === "attributes" && stepId.startsWith("attributes-")) return true;
    if (phaseFilter === "flows" && stepId.startsWith("flows-")) return true;
    return false;
}
