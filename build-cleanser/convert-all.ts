import { convert } from "./convert.js";
import { readdirSync, mkdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUILD_YAMLS_DIR = resolve(__dirname, "../build-yamls");
const FINAL_OUTPUT_DIR = resolve(__dirname, "../final-outputs");

export const convertAll = async () => {
    const domains = readdirSync(BUILD_YAMLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    const tasks = domains.flatMap((domain) => {
        const domainPath = join(BUILD_YAMLS_DIR, domain);
        const versions = readdirSync(domainPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

        return versions
            .map((version) => ({ domain, version, domainPath }))
            .filter(({ version, domainPath }) =>
                existsSync(join(domainPath, version, "build.yaml")),
            );
    });

    const results = await Promise.allSettled(
        tasks.map(async ({ domain, version, domainPath }) => {
            const inputPath = join(domainPath, version, "build.yaml");
            const outputDir = join(FINAL_OUTPUT_DIR, domain, version);
            mkdirSync(outputDir, { recursive: true });
            const outputPath = join(outputDir, "build.yaml");

            console.log(`\n[${domain}/${version}] Starting...`);
            await convert(inputPath, outputPath);
            console.log(`[${domain}/${version}] Done.`);

            return `${domain}/${version}`;
        }),
    );

    const failed = results
        .map((result, i) => ({ result, task: tasks[i] }))
        .filter(({ result }) => result.status === "rejected");

    console.log("\n─── Conversion Report ───────────────────────────────────");
    console.log(`  Total:   ${tasks.length}`);
    console.log(`  Success: ${tasks.length - failed.length}`);
    console.log(`  Failed:  ${failed.length}`);

    if (failed.length > 0) {
        console.log(
            "\n─── Failures ────────────────────────────────────────────",
        );
        for (const { result, task } of failed) {
            const reason = (result as PromiseRejectedResult).reason;
            console.error(`\n[${task.domain}/${task.version}]`);
            console.error(reason instanceof Error ? reason.stack : reason);
        }
        process.exitCode = 1;
    }
    console.log("─────────────────────────────────────────────────────────\n");
};
