import { parse as parseYaml } from "yaml";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

const REPO_OWNER = "ONDC-Official";
const REPO_NAME = "automation-specifications";
const WORKFLOW_FILE = "spec-workflow.yml";

async function githubApi(path: string, method: string, token: string, body?: object) {
    const res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(`GitHub API ${method} ${path} -> ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

function collectBranches(formattedConfigsDir: string): string[] {
    const branches: string[] = [];
    const domains = readdirSync(formattedConfigsDir).filter(d =>
        statSync(join(formattedConfigsDir, d)).isDirectory()
    );
    for (const domain of domains) {
        const domainPath = join(formattedConfigsDir, domain);
        const versions = readdirSync(domainPath).filter(v =>
            statSync(join(domainPath, v)).isDirectory()
        );
        for (const version of versions) {
            const indexYamlPath = join(domainPath, version, "config/index.yaml");
            if (!existsSync(indexYamlPath)) {
                console.warn(`Skipping ${domain}/${version}: no index.yaml found`);
                continue;
            }
            const doc = parseYaml(readFileSync(indexYamlPath, "utf-8"));
            const branchName = doc?.info?.["x-branch-name"];
            if (!branchName) {
                console.warn(`Skipping ${domain}/${version}: no x-branch-name in index.yaml`);
                continue;
            }
            branches.push(branchName);
        }
    }
    return branches;
}

export async function rerunWorkflows() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error("Error: GITHUB_TOKEN environment variable is not set.");
        process.exit(1);
    }

    const cwd = process.cwd();
    const formattedConfigsDir = resolve(cwd, "../formatted-configs");

    if (!existsSync(formattedConfigsDir)) {
        console.error(`Error: Could not find ${formattedConfigsDir}`);
        return;
    }

    const branches = collectBranches(formattedConfigsDir);
    if (branches.length === 0) {
        console.log("No branches found to rerun.");
        return;
    }

    console.log(`Found ${branches.length} branch(es) to trigger workflows on:\n  ${branches.join("\n  ")}\n`);

    for (const branch of branches) {
        console.log(`Triggering ${WORKFLOW_FILE} on branch: ${branch} ...`);
        try {
            await githubApi(
                `/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
                "POST",
                token,
                { ref: branch }
            );
            console.log(`  ✓ Dispatched`);
        } catch (err) {
            console.error(`  ✗ Failed for branch ${branch}:`, (err as Error).message);
        }
    }

    console.log("\nDone.");
}
