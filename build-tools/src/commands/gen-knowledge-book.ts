import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { BuildConfig } from "../types/build-type.js";
import { KNOWLEDGE_PIPELINE } from "../knowledge-book/pipeline.js";
import { createLLMProvider } from "../knowledge-book/llm/factory.js";
import { renderBook } from "../knowledge-book/render/book.js";
import type { KnowledgeBook, KnowledgeSection, ProcessorContext } from "../knowledge-book/types.js";

function loadAndParse(filePath: string): BuildConfig {
    let raw: string;
    try {
        raw = readFileSync(filePath, "utf-8");
    } catch {
        console.error(`\n  error: cannot read file: ${filePath}\n`);
        process.exit(1);
    }

    let doc: unknown;
    try {
        doc = parseYaml(raw);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  error: YAML parse failed: ${msg}\n`);
        process.exit(1);
    }

    const result = BuildConfig.safeParse(doc);
    if (!result.success) {
        console.error(
            `\n  error: config failed schema validation — run \`validate\` for details\n`,
        );
        process.exit(1);
    }
    return result.data;
}

function write(filePath: string, content: string): void {
    try {
        writeFileSync(filePath, content, "utf-8");
    } catch {
        console.error(`\n  error: cannot write file: ${filePath}\n`);
        process.exit(1);
    }
}

interface KnowledgeBookOptions {
    config: string;
    output: string;
    provider?: string;
    model?: string;
    apiKey?: string;
}

export function createKnowledgeBookCommand(): Command {
    return new Command("gen-knowledge-book")
        .description("Generate an AI-enriched knowledge book from a resolved build config")
        .requiredOption("-c, --config <path>", "Path to the resolved build.yaml")
        .option("-o, --output <dir>", "Output directory for the knowledge book", "knowledge-book")
        .option("--provider <name>", "LLM provider — overrides AI_TYPE env var")
        .option("--model <model>", "Model name — overrides AI_MODEL env var")
        .option("--api-key <key>", "API key — overrides AI_API_KEY env var")
        .action(async (opts: KnowledgeBookOptions) => {
            const inputPath = resolve(opts.config);
            const outputDir = resolve(opts.output);

            const config = loadAndParse(inputPath);
            console.log(
                `\n  Building knowledge book: ${config.info.domain} ${config.info.version}`,
            );
            console.log(`  Processors: ${KNOWLEDGE_PIPELINE.length}`);

            const provider = opts.provider ?? process.env["AI_TYPE"] ?? "anthropic";
            const apiKey = opts.apiKey ?? process.env["AI_API_KEY"];
            const model = opts.model ?? process.env["AI_MODEL"] ?? "claude-haiku-4-5-20251001";

            if (!apiKey) {
                console.error(`\n  error: no API key — set AI_API_KEY or pass --api-key\n`);
                process.exit(1);
            }

            if (provider !== "anthropic" && provider !== "openai-compat") {
                console.error(
                    `\n  error: unknown provider "${provider}" — expected anthropic or openai-compat\n`,
                );
                process.exit(1);
            }

            const baseUrl = process.env["AI_BASE_URL"] ?? "https://api.ollama.com/v1";

            // Diagnostic: confirm what values were resolved
            const maskedKey = apiKey
                ? `${apiKey.slice(0, 4)}${"..".repeat(4)}${apiKey.slice(-4)}`
                : "(none)";
            console.log(`  provider : ${provider}`);
            console.log(`  model    : ${model}`);
            console.log(`  baseUrl  : ${baseUrl}`);
            console.log(`  apiKey   : ${maskedKey}`);
            const llm = createLLMProvider(
                provider === "openai-compat"
                    ? { provider: "openai-compat", model, apiKey, baseUrl }
                    : { provider: "anthropic", model, apiKey: apiKey! },
            );

            process.stdout.write(`  Checking LLM connection (${provider} / ${model})...`);
            try {
                await llm.ping();
                process.stdout.write(` ok\n`);
            } catch (err) {
                process.stdout.write(` FAILED\n`);
                if (err instanceof Error) {
                    console.error(`\n  error: LLM preflight failed: ${err.message}`);
                    // Surface HTTP status / response body when available (openai SDK wraps these)
                    const e = err as unknown as Record<string, unknown>;
                    if (e["status"]) console.error(`  status : ${e["status"]}`);
                    if (e["code"]) console.error(`  code   : ${e["code"]}`);
                    if (e["body"]) console.error(`  body   : ${e["body"]}`);
                    if (e["headers"]) console.error(`  headers: ${JSON.stringify(e["headers"])}`);
                } else {
                    console.error(`\n  error: LLM preflight failed: ${String(err)}`);
                }
                console.error(
                    `\n  Hint: check AI_API_KEY, AI_BASE_URL, and AI_MODEL in your .env\n`,
                );
                process.exit(1);
            }

            const sections: KnowledgeSection[] = [];

            for (const processor of KNOWLEDGE_PIPELINE) {
                process.stdout.write(`  [${processor.id}] ${processor.title}...`);

                const ctx: ProcessorContext = { config, llm, bookSoFar: sections, outputDir };

                try {
                    const section = await processor.run(ctx);
                    sections.push(section);
                    process.stdout.write(` done\n`);
                } catch (err) {
                    process.stdout.write(` FAILED\n`);
                    if (err instanceof Error) {
                        console.error(
                            `\n  error: processor "${processor.id}" failed: ${err.message}`,
                        );
                        const e = err as unknown as Record<string, unknown>;
                        if (e["status"]) console.error(`  status : ${e["status"]}`);
                        if (e["code"]) console.error(`  code   : ${e["code"]}`);
                        if (err.stack) console.error(`\n${err.stack}`);
                    } else {
                        console.error(
                            `\n  error: processor "${processor.id}" failed: ${String(err)}`,
                        );
                    }
                    process.exit(1);
                }
            }

            const book: KnowledgeBook = {
                config,
                sections,
                generatedAt: new Date().toISOString(),
            };

            const files = renderBook(book);
            mkdirSync(outputDir, { recursive: true });

            for (const [filename, content] of files) {
                write(join(outputDir, filename), content);
            }

            console.log(`\n  Generated ${sections.length} sections + index`);
            console.log(`  Output: ${outputDir}\n`);
        });
}

export function createEnrichmentCommand(): Command {
    return new Command("enrich")
        .description("Enrich the config with additional information using the knowledge book")
        .requiredOption("-c, --config <path>", "Path to the config file")
        .option(
            "-o, --output <path>",
            "Output path for the enriched config",
            "enriched-config.yaml",
        )
        .action((_options) => {
            // TODO: implement
        });
}
