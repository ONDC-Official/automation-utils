import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { BuildConfig } from "../types/build-type.js";
import {
    diffInfo,
    diffFlows,
    diffAttributes,
    diffErrors,
    diffActions,
    diffPaths,
    diffValidations,
    diffDocs,
    diffComponents,
    diffSecurity,
} from "../change-logs/diff.js";
import type { ChangeLog, ChangeSection } from "../change-logs/types.js";

function loadAndParse(filePath: string, label: string): BuildConfig {
    let raw: string;
    try {
        raw = readFileSync(filePath, "utf-8");
    } catch {
        console.error(`\n  error: cannot read ${label}: ${filePath}\n`);
        process.exit(1);
    }

    let doc: unknown;
    try {
        doc = parseYaml(raw);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  error: YAML parse failed for ${label}: ${msg}\n`);
        process.exit(1);
    }

    const result = BuildConfig.safeParse(doc);
    if (!result.success) {
        console.error(
            `\n  error: ${label} failed schema validation — run \`validate\` for details\n`,
        );
        process.exit(1);
    }
    return result.data;
}

export function createGenChangeLogsCommand(): Command {
    return new Command("gen-change-logs")
        .description("Generate a structured changelog between two resolved build configs")
        .requiredOption("--old <path>", "Path to the old build.yaml (or resolved config)")
        .requiredOption("--new <path>", "Path to the new build.yaml (or resolved config)")
        .option(
            "-o, --output <path>",
            "Output path for the changelog (.json) — defaults to changelog_<domain>_<version>_<date>.json",
        )
        .action((opts: { old: string; new: string; output?: string }) => {
            const oldConfig = loadAndParse(resolve(opts.old), "old config");
            const newConfig = loadAndParse(resolve(opts.new), "new config");

            // Run all section diffs — includes new sections
            const rawSections: (ChangeSection | null)[] = [
                diffInfo(oldConfig, newConfig),
                diffFlows(oldConfig, newConfig),
                diffAttributes(oldConfig, newConfig),
                diffErrors(oldConfig, newConfig),
                diffActions(oldConfig, newConfig),
                diffPaths(oldConfig, newConfig),
                diffValidations(oldConfig, newConfig),
                diffDocs(oldConfig, newConfig),
                diffComponents(oldConfig, newConfig),
                diffSecurity(oldConfig, newConfig),
            ];

            const sections = rawSections.filter((s): s is ChangeSection => s !== null);
            const totalChanges = sections.reduce((sum, s) => sum + s.totalChanges, 0);

            const changelog: ChangeLog = {
                schemaVersion: 1,
                generatedAt: new Date().toISOString(),
                old: {
                    domain: oldConfig.info.domain,
                    version: oldConfig.info.version,
                    branch: oldConfig.info["x-branch-name"],
                },
                new: {
                    domain: newConfig.info.domain,
                    version: newConfig.info.version,
                    branch: newConfig.info["x-branch-name"],
                },
                summary: {
                    totalChanges,
                    sections: sections.map((s) => ({
                        section: s.section,
                        label: s.label,
                        count: s.totalChanges,
                    })),
                },
                sections,
            };

            const date = new Date().toISOString();
            const domain = newConfig.info.domain.replace(/[^a-zA-Z0-9]/g, "-");
            const version = newConfig.info.version.replace(/[^a-zA-Z0-9.]/g, "-");
            const defaultName = `changelog_${domain}_${version}_${date}.json`;
            const outPath = resolve(opts.output ?? defaultName);
            try {
                writeFileSync(outPath, JSON.stringify(changelog, null, 2), "utf-8");
            } catch {
                console.error(`\n  error: cannot write output: ${outPath}\n`);
                process.exit(1);
            }

            // Human-readable summary to stdout
            console.log(
                `\n  Changelog: ${oldConfig.info.domain} ${oldConfig.info.version} → ${newConfig.info.version}`,
            );
            console.log(`  Total changes: ${totalChanges}\n`);
            for (const s of sections) {
                const truncNote = s.truncated
                    ? ` (showing ${s.entries.length} of ${s.totalChanges})`
                    : "";
                console.log(`  [${s.label}] ${s.totalChanges} change(s)${truncNote}`);
            }
            if (totalChanges === 0) {
                console.log("  No changes detected.");
            }
            console.log(`\n  Written to: ${outPath}\n`);
        });
}
