import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { BuildConfig } from "../types/build-type.js";
import { renderIndexPage } from "../markdown/index-page.js";
import { renderFlowsIndex, renderFlowPage } from "../markdown/flows.js";
import { renderAttributesPage } from "../markdown/attributes.js";
import { renderErrorsPage } from "../markdown/errors.js";
import { renderActionsPage } from "../markdown/actions.js";

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
        console.error(`\n  error: config failed schema validation — run \`validate\` for details\n`);
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

export function generateDocs(config: BuildConfig, outputDir: string): void {
    const flowsDir = join(outputDir, "flows");
    const attrsDir = join(outputDir, "attributes");
    mkdirSync(flowsDir, { recursive: true });
    mkdirSync(attrsDir, { recursive: true });

    // x-docs: write verbatim at root
    const docFiles: string[] = [];
    if (config["x-docs"]) {
        for (const [stem, content] of Object.entries(config["x-docs"])) {
            const fileName = stem.endsWith(".md") ? stem : `${stem}.md`;
            write(join(outputDir, fileName), content);
            docFiles.push(fileName);
        }
    }

    // index.md
    write(join(outputDir, "index.md"), renderIndexPage(config, docFiles));

    // errors.md
    write(join(outputDir, "errors.md"), renderErrorsPage(config));

    // actions.md
    write(join(outputDir, "actions.md"), renderActionsPage(config));

    // flows/index.md + flows/<id>.md
    write(join(flowsDir, "index.md"), renderFlowsIndex(config["x-flows"]));
    for (const flow of config["x-flows"]) {
        write(join(flowsDir, `${flow.id}.md`), renderFlowPage(flow));
    }

    // attributes/<use-case-id>.md
    for (const attrSet of config["x-attributes"]) {
        const useCase = attrSet.meta?.use_case_id ?? "unknown";
        const safeId = useCase.replace(/[^a-zA-Z0-9-_]/g, "-");
        write(join(attrsDir, `${safeId}.md`), renderAttributesPage(attrSet));
    }
}

export function createMdCommand(): Command {
    return new Command("gen-md")
        .description("Generate markdown documentation from a resolved build config yaml")
        .requiredOption("-i, --input <path>", "Path to the resolved build.yaml")
        .option("-o, --output <dir>", "Output directory for markdown files (default: ./docs)")
        .action((opts: { input: string; output?: string }) => {
            const inputPath = resolve(opts.input);
            const outputDir = resolve(opts.output ?? "./docs");

            const config = loadAndParse(inputPath);

            generateDocs(config, outputDir);

            const domain = config.info.domain;
            const version = config.info.version;
            const flowCount = config["x-flows"].length;
            const attrCount = config["x-attributes"].length;

            console.log(`\n  Generated docs: ${domain} ${version}`);
            console.log(`  Flows: ${flowCount} | Attribute sets: ${attrCount}`);
            console.log(`\n  Output: ${outputDir}\n`);
        });
}
