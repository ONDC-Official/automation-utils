import { readFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BuildConfig } from "../types/build-type.js";
import { runValidationPipeline } from "../validations/pipeline.js";

export interface ValidateOptions {
    input: string;
}

function formatZodError(err: z.ZodError): string {
    return err.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `  • ${path}: ${issue.message}`;
        })
        .join("\n");
}

export function createValidateCommand(): Command {
    return new Command("validate")
        .description("Validate a resolved build.yaml against the ONDC BuildConfig schema")
        .requiredOption("-i, --input <path>", "Path to the build YAML file to validate")
        .action((opts: ValidateOptions) => {
            const filePath = resolve(opts.input);

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

            // ── Step 1: Zod schema validation ────────────────────────────────
            const schemaResult = BuildConfig.safeParse(doc);

            if (!schemaResult.success) {
                console.error(`\n  ✗ Schema validation failed for: ${filePath}`);
                console.error(`\n  ${schemaResult.error.issues.length} issue(s) found:\n`);
                console.error(formatZodError(schemaResult.error));
                console.error();
                process.exit(1);
            }

            console.log(`\n  ✓ Schema valid`);

            // ── Step 2: semantic validation pipeline ─────────────────────────
            const report = runValidationPipeline(schemaResult.data);

            for (const name of report.passed) {
                console.log(`  ✓ ${name}`);
            }

            if (report.failed.length === 0) {
                console.log(`\n  All checks passed for: ${filePath}\n`);
                process.exit(0);
            }

            console.error(`\n  ✗ ${report.failed.length} check(s) failed:\n`);
            for (const check of report.failed) {
                console.error(`  [${check.name}] ${check.description}`);
                for (const issue of check.issues) {
                    console.error(`    • ${issue.path}: ${issue.message}`);
                }
                console.error();
            }

            process.exit(1);
        });
}
