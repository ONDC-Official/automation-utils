import { readFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AttributeNodeZ, BuildConfig } from "../types/build-type.js";
import { runValidationPipeline } from "../validations/pipeline.js";

export interface ValidateOptions {
    input: string;
}

export function createValidateCommand(): Command {
    return new Command("validate")
        .description("Validate a resolved build.yaml against the ONDC BuildConfig schema")
        .requiredOption("-i, --input <path>", "Path to the build YAML file to validate")
        .action((opts: ValidateOptions) => {
            const filePath = resolve(opts.input);

            console.log(`\n  Validating: ${filePath}\n`);

            let raw: string;
            try {
                raw = readFileSync(filePath, "utf-8");
            } catch {
                console.error(`  ✗ Cannot read file: ${filePath}\n`);
                process.exit(1);
            }

            let doc: unknown;
            try {
                doc = parseYaml(raw);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  ✗ YAML parse error\n`);
                console.error(`    ${msg}\n`);
                process.exit(1);
            }

            // ── Step 1: Zod schema validation ────────────────────────────────
            const schemaResult = BuildConfig.safeParse(doc);

            if (!schemaResult.success) {
                console.error(
                    `  ✗ Schema validation failed — ${schemaResult.error.issues.length} issue(s):\n`,
                );
                for (const issue of schemaResult.error.issues) {
                    const path = issue.path.join(".") || "(root)";
                    console.error(`    • ${path}: ${issue.message}`);
                }
                console.error();
                process.exit(1);
            }

            console.log(`  ✓ Schema valid\n`);

            // ── Step 2: semantic validation pipeline ─────────────────────────
            const report = runValidationPipeline(schemaResult.data as any);

            for (const name of report.passed) {
                console.log(`  ✓ ${name}`);
            }

            if (report.failed.length === 0) {
                console.log(`\n  All checks passed.\n`);
                process.exit(0);
            }

            console.error(`\n  ✗ ${report.failed.length} check(s) failed:\n`);
            for (const check of report.failed) {
                console.error(`  ✗ ${check.name}`);
                if (check.description) console.error(`    ${check.description}`);
                for (const issue of check.issues) {
                    console.error(`      • ${issue.path}: ${issue.message}`);
                }
                console.error();
            }

            process.exit(1);
        });
}
