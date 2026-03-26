import { parse as parseYaml } from "yaml";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const gitURl = "https://github.com/ONDC-Official/automation-specifications.git";
const oldGitUrl = "https://github.com/ONDC-Official/automation-config-store.git";

export function pushAll() {
    const cwd = process.cwd();
    const formattedConfigsDir = resolve(cwd, "../formatted-configs");

    if (!existsSync(formattedConfigsDir)) {
        console.error(`Error: Could not find ${formattedConfigsDir}`);
        return;
    }

    const domains = readdirSync(formattedConfigsDir).filter(dir => 
        statSync(join(formattedConfigsDir, dir)).isDirectory()
    );

    for (const domain of domains) {
        const domainPath = join(formattedConfigsDir, domain);
        const versions = readdirSync(domainPath).filter(dir => 
            statSync(join(domainPath, dir)).isDirectory()
        );

        for (const version of versions) {
            console.log(`\n\n=== Processing ${domain}/${version} ===`);
            pushDomainVersion(domain, version);
        }
    }
}

function pushDomainVersion(domain: string, version: string) {
    const cwd = process.cwd();
    const configDir = resolve(cwd, `../formatted-configs/${domain}/${version}`);
    const indexYamlPath = join(configDir, "config/index.yaml");

    if (!existsSync(indexYamlPath)) {
        console.error(`Error: Could not find ${indexYamlPath}`);
        return;
    }

    const rawYaml = readFileSync(indexYamlPath, "utf-8");
    const doc = parseYaml(rawYaml);
    
    const branchName = doc?.info?.["x-branch-name"];
    
    if (!branchName) {
        console.error("Error: Could not find 'info.x-branch-name' property in index.yaml");
        return;
    }

    console.log(`Using branch: ${branchName}`);

    const tmpDirBase = join(tmpdir(), `ondc-push-${Date.now()}-${branchName.replace(/[^a-zA-Z0-9-]/g, '-')}`);
    mkdirSync(tmpDirBase, { recursive: true });

    try {
        const specsRepoDir = join(tmpDirBase, "automation-specifications");
        const storeRepoDir = join(tmpDirBase, "automation-config-store");

        console.log(`Cloning ${gitURl} ...`);
        execSync(`git clone ${gitURl} ${specsRepoDir}`, { stdio: "inherit" });

        console.log(`Creating and checking out branch ${branchName}...`);
        // If branch exists remotely, checkout. Otherwise create it.
        try {
            execSync(`git ls-remote --exit-code --heads origin ${branchName}`, { cwd: specsRepoDir, stdio: "ignore" });
            // Exit code 0 means it exists on origin
            execSync(`git checkout ${branchName}`, { cwd: specsRepoDir, stdio: "inherit" });
        } catch {
            // Exit code 2 means it doesn't exist on origin, so we create it
            execSync(`git checkout -b ${branchName}`, { cwd: specsRepoDir, stdio: "inherit" });
        }

        console.log(`Copying configs...`);
        cpSync(configDir, specsRepoDir, { recursive: true });

        console.log(`Adding GitHub Actions workflow...`);
        const workflowsDir = join(specsRepoDir, ".github/workflows");
        mkdirSync(workflowsDir, { recursive: true });
        
        const workflowYaml = `name: Spec Workflow

on:
  push:
    branches: [ "main", "draft-*" ]
    paths:
      - 'config/**'
  workflow_dispatch:

jobs:
  process-spec:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Parse config
        id: parse
        run: |
          npx -y @ondc/build-tools@latest parse -i config -o build.yaml

      - name: Upload parsed build.yaml artifact
        uses: actions/upload-artifact@v4
        with:
          name: build-artifact
          path: build.yaml
          retention-days: 7

      - name: Validate build.yaml
        run: |
          npx -y @ondc/build-tools@latest validate -i build.yaml

      - name: Generate RAG Table
        run: |
          npx -y @ondc/build-tools@latest gen-rag-table -i build.yaml -o generated

      - name: Push to DB
        # Only deploy/push on pushes to main or manual dispatch, not on PRs (optional precaution)
        if: github.event_name != 'pull_request'
        env:
          API_KEY: \${{ secrets.DB_API_KEY }}
          API_BASE_URL: \${{ secrets.DB_BASE_URL_DEV || 'https://api.example.com' }}
        run: |
          npx -y @ondc/build-tools@latest push-to-db -f build.yaml -t generated/raw_table.json -u "$API_BASE_URL" -k "$API_KEY"
`;
        writeFileSync(join(workflowsDir, "spec-workflow.yml"), workflowYaml);

        console.log(`Checking old config store for mock-service on branch ${branchName}...`);
        try {
            execSync(`git clone --depth 1 -b ${branchName} ${oldGitUrl} ${storeRepoDir}`, { stdio: "ignore" });
            const mockServicePath = join(storeRepoDir, "mock-service");
            
            if (existsSync(mockServicePath)) {
                console.log(`Found mock-service folder. Copying alongside config...`);
                cpSync(mockServicePath, join(specsRepoDir, "mock-service"), { recursive: true });
            } else {
                console.log(`No mock-service folder found on branch ${branchName}.`);
            }
        } catch (err) {
            console.log(`Could not find branch ${branchName} in ${oldGitUrl} or mock-service check failed.`);
        }

        console.log("Committing to branch...");
        execSync(`git add .`, { cwd: specsRepoDir, stdio: "inherit" });
        execSync(`git commit -m "chore: push configs and mock-service for ${domain} ${version}" || true`, { 
            cwd: specsRepoDir, 
            stdio: "inherit" 
        });

        console.log(`Pushing branch ${branchName} to remote...`);
        execSync(`git push -u origin ${branchName}`, { cwd: specsRepoDir, stdio: "inherit" });

        console.log(`\nSuccess for ${domain}/${version}!`);

    } catch (err) {
        console.error(`An error occurred processing ${domain}/${version}:`, err);
    } finally {
        console.log("Cleaning up temp directories...");
        rmSync(tmpDirBase, { recursive: true, force: true });
    }
}
