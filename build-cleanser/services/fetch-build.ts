import { parseYaml } from "../convert.js";

const gitRepoLink = "https://github.com/ONDC-Official/automation-config-store";
const token = process.env.GITHUB_TOKEN;
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const outputsDir = "../build-yamls";

async function getAllBranches(repoUrl: string): Promise<string[]> {
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);
    const [, owner, repo] = match;

    const branches: string[] = [];
    let page = 1;

    while (true) {
        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100&page=${page}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                },
            },
        );

        if (!response.ok) {
            throw new Error(
                `GitHub API error: ${response.status} ${response.statusText}`,
            );
        }

        const data = (await response.json()) as { name: string }[];
        if (data.length === 0) break;

        branches.push(...data.map((b) => b.name));
        if (data.length < 100) break;
        page++;
    }

    return branches.filter((b) => b.startsWith("draft-"));
}

const buildYamlPath = "api-service/src/config/build.yaml";

async function fetchBuildYaml(
    owner: string,
    repo: string,
    branch: string,
): Promise<string> {
    const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${buildYamlPath}?ref=${branch}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github.raw+json",
            },
        },
    );

    if (!response.ok) {
        throw new Error(
            `Failed to fetch build.yaml for branch "${branch}": ${response.status} ${response.statusText}`,
        );
    }

    return response.text();
}

export async function finalBuild() {
    const allBranches = await getAllBranches(gitRepoLink);
    console.log("Branches in CONFIG-STORE:", allBranches);

    const match = gitRepoLink.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) throw new Error(`Invalid GitHub repo URL: ${gitRepoLink}`);
    const [, owner, repo] = match;

    for (const branch of allBranches) {
        try {
            console.log(`Fetching build.yaml for branch: ${branch}`);
            const buildYamlContent = await fetchBuildYaml(owner, repo, branch);
            const data = parseYaml(buildYamlContent);
            const domain = data.info.domain;
            const version = data.info.version;
            const finalPath = path.resolve(
                __dirname,
                `${outputsDir}/${domain}/${version}/build.yaml`,
            );
            await fs.promises.mkdir(path.dirname(finalPath), {
                recursive: true,
            });
            await fs.promises.writeFile(finalPath, buildYamlContent);
            const metaData = {
                domain,
                version,
                branch,
            };
            await fs.promises.writeFile(
                path.resolve(
                    __dirname,
                    `${outputsDir}/${domain}/${version}/metadata.json`,
                ),
                JSON.stringify(metaData, null, 2),
            );
            console.log(
                `Saved build.yaml and metadata for ${domain} ${version}`,
            );
        } catch (err) {
            console.error(`Error processing branch ${branch}:`, err);
        }
    }
}
