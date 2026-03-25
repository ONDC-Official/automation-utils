import { existsSync, readdirSync, rmSync, renameSync, mkdirSync, mkdtempSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { Command } from "commander";

function findGeneratorBin(): string {
    const local = resolve("./node_modules/.bin/ondc-code-generator");
    return existsSync(local) ? local : "npx";
}

/** Recursively find the first file named `target` under `dir`. */
function findFile(dir: string, target: string): string | null {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findFile(full, target);
            if (found) return found;
        } else if (entry.name === target) {
            return full;
        }
    }
    return null;
}

export function createGenRagTableCommand(): Command {
    return new Command("gen-rag-table")
        .description("Generate raw_table.json from a build.yaml using the RAG table generator")
        .requiredOption("-i, --input <path>", "Path to the build.yaml file")
        .option(
            "-o, --output <dir>",
            "Output directory for raw_table.json (defaults to <input-dir>/generated)",
        )
        .action((opts: { input: string; output?: string }) => {
            const inputPath = resolve(opts.input);

            if (!existsSync(inputPath)) {
                console.error(`\n  error: input file not found: ${inputPath}\n`);
                process.exit(1);
            }

            const inputDir = resolve(inputPath, "..");
            const outputDir = resolve(opts.output ?? join(inputDir, "generated"));

            // Run generator into an isolated temp dir so stray files never touch outputDir
            const tmpDir = mkdtempSync(join(tmpdir(), "ondc-rag-"));

            try {
                const bin = findGeneratorBin();
                const args =
                    bin === "npx"
                        ? [
                              "--yes",
                              "ondc-code-generator",
                              "xval",
                              "-c",
                              inputPath,
                              "-o",
                              tmpDir,
                              "-l",
                              "rag_table",
                          ]
                        : ["xval", "-c", inputPath, "-o", tmpDir, "-l", "rag_table"];

                console.log("\n  Running RAG table generator...");

                const result = spawnSync(bin, args, { stdio: "inherit", shell: false });

                if (result.error) {
                    console.error(
                        `\n  error: failed to spawn generator: ${result.error.message}\n`,
                    );
                    process.exit(1);
                }

                if (result.status !== 0) {
                    console.error(`\n  error: generator exited with code ${result.status}\n`);
                    process.exit(1);
                }

                // Find raw_table.json anywhere inside the temp dir
                const foundPath = findFile(tmpDir, "raw_table.json");
                if (!foundPath) {
                    console.error(`\n  error: raw_table.json not found in generator output\n`);
                    process.exit(1);
                }

                // Move it to the final destination
                mkdirSync(outputDir, { recursive: true });
                const finalPath = join(outputDir, "raw_table.json");
                renameSync(foundPath, finalPath);

                console.log(`\n  raw_table.json written to: ${finalPath}\n`);
            } finally {
                // Always clean up the temp dir — nothing else survives
                rmSync(tmpDir, { recursive: true, force: true });
            }
        });
}
