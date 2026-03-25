import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { closest } from "fastest-levenshtein";
import { OldFlows } from "../types/old-build.js";
import { Flow } from "../types/new-build.js";
import { generatePlaygroundConfigFromFlowConfigWithMeta } from "@ondc/automation-mock-runner";
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
        const flowIds = fs
            .readdirSync(usecaseDir)
            .filter((entry) =>
                fs.statSync(path.join(usecaseDir, entry)).isDirectory(),
            );

        for (const flowId of flowIds) {
            try {
                const matchedSummary = closest(flowId, oldFlowSummaries);
                const matchedOldFlow = oldFlows.find(
                    (f) => f.summary === matchedSummary,
                )!;

                const flowDir = path.join(usecaseDir, flowId);
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
                const newFlowConfig =
                    await generatePlaygroundConfigFromFlowConfigWithMeta(
                        latestPayloadGroup,
                        flowsJson,
                        domain,
                        version,
                    );

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
                        step.examples.push(deepClonedPayloads[matchIndex]);
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
