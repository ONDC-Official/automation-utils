import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { closest } from "fastest-levenshtein";
import { OldFlows } from "../types/old-build.js";
import { Flow } from "../types/new-build.js";
import { generatePlaygroundConfigFromFlowConfigWithMeta } from "@ondc/automation-mock-runner";
import axios from "axios";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputsBase = path.resolve(__dirname, "../../outputs");

export async function flowConverter(
    oldFlows: OldFlows,
    domain: string,
    version: string,
): Promise<Flow[]> {
    console.log(
        `Starting flow conversion for domain: ${domain}, version: ${version}`,
    );
    const newFlows = [];
    const versionDir = path.join(outputsBase, domain, version);
    const usecases = fs
        .readdirSync(versionDir)
        .filter((entry) =>
            fs.statSync(path.join(versionDir, entry)).isDirectory(),
        );

    const oldFlowSummaries = oldFlows.map((f) => f.summary);
    for (const usecase of usecases) {
        const usecaseDir = path.join(versionDir, usecase);
        const flowEntries = findFlowDirs(usecaseDir);

        for (const { flowId, flowDir } of flowEntries) {
            try {
                const matchedSummary = closest(flowId, oldFlowSummaries);
                const matchedOldFlow = oldFlows.find(
                    (f) => f.summary === matchedSummary,
                )!;
                const flowsPath = path.join(flowDir, "flow.json");
                const payloadsPath = path.join(flowDir, "payloads.json");

                const flowsJson = fs.existsSync(flowsPath)
                    ? JSON.parse(fs.readFileSync(flowsPath, "utf-8"))
                    : null;

                const payloadsJson = fs.existsSync(payloadsPath)
                    ? JSON.parse(fs.readFileSync(payloadsPath, "utf-8"))
                    : [[]];
                const latestPayloadGroup = findLatestPayloadGroup(
                    payloadsJson,
                    domain,
                    version,
                ).sort(
                    (a, b) =>
                        new Date(b.context.timestamp).getTime() -
                        new Date(a.context.timestamp).getTime(),
                );
                const deepClonedPayloads: any = JSON.parse(
                    JSON.stringify(latestPayloadGroup),
                );
                let newFlowConfig =
                    await generatePlaygroundConfigFromFlowConfigWithMeta(
                        latestPayloadGroup,
                        flowsJson,
                        domain,
                        version,
                    );

                const playgroundHostedConfig = await fetchLiveConfig(
                    domain,
                    version,
                    usecase,
                    flowId,
                );
                if (playgroundHostedConfig) {
                    newFlowConfig = playgroundHostedConfig;
                }

                for (const step of newFlowConfig.steps) {
                    step.examples = [];
                    const action = step.api;
                    console.log(
                        `Processing step with action "${action}" in flow "${flowId}"`,
                    );
                    const matchIndex = deepClonedPayloads.findIndex(
                        (payload: any) => payload.context?.action === action,
                    );
                    if (matchIndex !== -1) {
                        step.examples.push({
                            name: `Example for action "${action}"`,
                            description: `Auto-generated example for action "${action}" in flow "${flowId}"`,
                            payload: deepClonedPayloads[matchIndex],
                            type: "request",
                        });
                        deepClonedPayloads.splice(matchIndex, 1);
                    } else {
                        console.warn(
                            `No matching payload found for action "${action}" in step of flow "${flowId}"`,
                        );
                    }
                }

                const oldDescription = matchedOldFlow.description
                    ? matchedOldFlow.details[0].description
                    : matchedOldFlow.summary;
                newFlowConfig.meta.description = oldDescription;
                newFlowConfig.meta.flowName = flowId
                    .trim()
                    .split("_")
                    .join(" ");

                newFlowConfig.meta.use_case_id = usecase;
                newFlowConfig.meta.flowId = flowId;
                newFlows.push(newFlowConfig);
            } catch (error) {
                console.error(
                    `[SKIP] Failed to convert flow "${flowId}" (usecase: ${usecase}, domain: ${domain}, version: ${version})`,
                );
                console.error(error instanceof Error ? error.stack : error);
            }
        }
    }
    return newFlows;
}

function findFlowDirs(
    usecaseDir: string,
): { flowId: string; flowDir: string }[] {
    const results: { flowId: string; flowDir: string }[] = [];

    function walk(dir: string, relParts: string[]) {
        const hasFlowJson = fs.existsSync(path.join(dir, "flow.json"));
        const hasPayloads = fs.existsSync(path.join(dir, "payloads.json"));
        if (hasFlowJson || hasPayloads) {
            results.push({
                flowId: relParts.join("/"),
                flowDir: dir,
            });
            return; // don't recurse further once we found the leaf
        }
        const entries = fs
            .readdirSync(dir)
            .filter((e) => fs.statSync(path.join(dir, e)).isDirectory());
        for (const entry of entries) {
            walk(path.join(dir, entry), [...relParts, entry]);
        }
    }

    walk(usecaseDir, []);
    return results;
}

function findLatestPayloadGroup(
    payloads: unknown[][],
    domain: string,
    version: string,
): any[] {
    try {
        const latestGroup = payloads.reduce((latest, group) => {
            const latestTs = (latest[0] as any)?.jsonRequest?.context
                ?.timestamp;
            const groupTs = (group[0] as any)?.jsonRequest?.context?.timestamp;
            return new Date(groupTs) > new Date(latestTs) ? group : latest;
        });
        return latestGroup.map((item) => (item as any).jsonRequest);
    } catch (error) {
        console.warn(
            `Warning: Failed to find latest payload group, defaulting to first group.
            Domain: ${domain}, Version: ${version}
            Error: ${error} `,
        );
        return [];
    }
}

async function fetchLiveConfig(
    domain: string,
    version: string,
    usecase: string,
    flowId: string,
): Promise<any> {
    try {
        const url = `${process.env.CONFIG_SERVICE_URL}/mock/playground`;
        const playgroundConfig = await axios.get(url, {
            params: {
                domain,
                version,
                usecase,
                flowId,
            },
        });
        console.log(
            `Fetched live config from playground for domain "${domain}", version "${version}", usecase "${usecase}", flow "${flowId}"`,
        );
        return playgroundConfig.data;
    } catch (error) {
        console.warn(
            `Warning: Failed to fetch live config for domain "${domain}", version "${version}", usecase "${usecase}", flow "${flowId}". Error: ${error}`,
        );
        return undefined;
    }
}
