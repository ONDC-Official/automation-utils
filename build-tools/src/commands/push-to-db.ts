import { Command } from "commander";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PushToDbOptions {
    file: string;
    table: string;
    url: string;
    key?: string;
}

export function createPushToDbCommand(): Command {
    return new Command("push-to-db")
        .description("Push build spec to database using ingest-spec.sh")
        .requiredOption("-f, --file <path>", "Path to the build.yaml file")
        .requiredOption("-t, --table <path>", "Path to the raw_table.json file")
        .requiredOption("-u, --url <url>", "Base URL (e.g. https://api.example.com)")
        .option("-k, --key <key>", "x-api-key override (default: $X_API_KEY env var)")
        .action((opts: PushToDbOptions) => {
            const scriptPath = path.resolve(__dirname, "../../scripts/ingest-spec.sh");
            
            let cmd = `bash "${scriptPath}" -f "${opts.file}" -t "${opts.table}" -u "${opts.url}"`;
            if (opts.key) {
                cmd += ` -k "${opts.key}"`;
            }
            
            try {
                execSync(cmd, { stdio: "inherit" });
            } catch (error) {
                process.exit(1);
            }
        });
}
