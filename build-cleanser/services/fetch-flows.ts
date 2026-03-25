import { getPayloads } from "./mongo-payloads.js";
import { fetchDomains, fetchFlow } from "../utils/config-service.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = "../outputs";

export async function getFlows() {
    const data = await fetchDomains();
    const errors: string[] = [];

    for (const domain of data.domain) {
        for (const version of domain.version) {
            for (const usecase of version.usecase) {
                try {
                    const flowConfig = await fetchFlow(
                        domain.key,
                        version.key,
                        usecase,
                    );
                    console.log(
                        `Flows for domain: ${domain.key}, version: ${version.key}, usecase: ${usecase}`,
                    );
                    for (const flow of flowConfig) {
                        console.log(`  Flow ID: ${flow.id}`);
                        const actions = flow.sequence.map((step) => step.type);
                        const payloads = await getPayloads(
                            domain.key,
                            version.key,
                            flow.id,
                            actions,
                            actions.length,
                        );
                        const output = `${OUTPUT_PATH}/${domain.key}/${version.key}/${usecase}/${flow.id}/payloads.json`;
                        const folderPath = path.resolve(__dirname, output);
                        await fs.promises.mkdir(path.dirname(folderPath), {
                            recursive: true,
                        });
                        const outputFlow = `${OUTPUT_PATH}/${domain.key}/${version.key}/${usecase}/${flow.id}/flow.json`;
                        await fs.promises.writeFile(
                            folderPath,
                            JSON.stringify(payloads, null, 2),
                        );
                        await fs.promises.writeFile(
                            path.resolve(__dirname, outputFlow),
                            JSON.stringify(flow, null, 2),
                        );
                        console.log(`    Saved payloads to ${output}`);
                    }
                } catch (err: any) {
                    console.error(
                        `Error processing domain=${domain.key} version=${version.key} usecase=${usecase}:`,
                        err,
                    );
                    errors.push(
                        `domain=${domain.key} version=${version.key} usecase=${usecase}: ${err?.message ?? "unknown error"}`,
                    );
                }
            }
        }
    }
    // Save errors to a file
    if (errors.length) {
        const errorOutput = `${OUTPUT_PATH}/errors.log`;
        await fs.promises.mkdir(
            path.dirname(path.resolve(__dirname, errorOutput)),
            {
                recursive: true,
            },
        );
        await fs.promises.writeFile(
            path.resolve(__dirname, errorOutput),
            errors.join("\n"),
        );
        console.log(`Saved errors to ${errorOutput}`);
    }
}
