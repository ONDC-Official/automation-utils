import {
    readdirSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const FINAL_OUTPUTS_DIR = resolve("../final-outputs");
const BUILD_YAMLS_DIR = resolve("../build-yamls");
const OUTPUTS_DIR = resolve("../outputs");
const FORMATTED_CONFIGS_DIR = resolve("../formatted-configs");

function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

interface FlowMeta {
    tags: string[];
    description: string;
}

function readFlowMeta(
    domain: string,
    version: string,
    usecase: string,
    flowId: string,
): FlowMeta {
    const flowJsonPath = join(
        OUTPUTS_DIR,
        domain,
        version,
        usecase,
        flowId,
        "flow.json",
    );
    if (!existsSync(flowJsonPath)) return { tags: [], description: "" };
    try {
        const data = JSON.parse(readFileSync(flowJsonPath, "utf-8")) as Record<
            string,
            unknown
        >;
        return {
            tags: (data["tags"] as string[] | undefined) ?? [],
            description: (data["description"] as string | undefined) ?? "",
        };
    } catch {
        return { tags: [], description: "" };
    }
}

async function fetchReporting(
    domain: string,
    version: string,
): Promise<boolean> {
    const base = process.env.CONFIG_SERVICE_URL;
    if (!base) return false;
    try {
        const url = `${base}/ui/reporting?domain=${encodeURIComponent(domain)}&version=${encodeURIComponent(version)}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(
                `Reporting check failed for ${domain}/${version}: ${res.status} ${res.statusText}`,
            );
            return false;
        }
        const data = (await res.json()) as Record<string, unknown>;
        console.log(`Reporting check for ${domain}/${version}:`, data);
        return data.data === true;
    } catch {
        return false;
    }
}

function readBranchName(domain: string, version: string): string | undefined {
    const metaPath = join(BUILD_YAMLS_DIR, domain, version, "metadata.json");
    if (!existsSync(metaPath)) return undefined;
    try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<
            string,
            unknown
        >;
        return meta["branch"] as string | undefined;
    } catch {
        return undefined;
    }
}

function generateReadme(
    domain: string,
    version: string,
    branchName: string | undefined,
    usecases: string[],
): string {
    const branch = branchName ?? "N/A";
    const usecaseList =
        usecases.length > 0
            ? usecases.map((u) => `  - ${u}`).join("\n")
            : "  (none)";
    return `# ${domain} — version ${version}

**Branch:** \`${branch}\`  
**Use Cases:** ${usecases.length > 0 ? usecases.join(", ") : "N/A"}

---

## Directory Structure

\`\`\`
${version}/
├── README.md                   ← This file
└── config/
    ├── index.yaml              ← Top-level manifest; mirrors build.yaml structure with $ref links
    ├── specs/
    │   └── openapi.yaml        ← Full OpenAPI spec: openapi, info, security, paths, components
    ├── flows/
    │   ├── index.yaml              ← $ref list pointing to each <UseCase>/index.yaml
    │   └── <UseCase>/
    │       ├── index.yaml          ← Playground manifest: id, tags, description, config.$ref
    │       └── <FlowId>.yaml       ← Individual transaction flow definition
    ├── attributes/
    │   ├── index.yaml          ← List of $ref entries pointing to each attribute file
    │   └── <UseCaseId>.yaml    ← Attribute set for a specific use case
    ├── validations/
    │   └── index.yaml          ← All validation rules (x-validations from build.yaml)
    ├── errors/
    │   └── index.yaml          ← Error codes (x-errorcodes from build.yaml)
    └── actions/
        └── index.yaml          ← Supported actions & API properties (x-supported-actions)
\`\`\`

---

## File Schemas

### \`config/index.yaml\`
Top-level manifest that mimics the build.yaml structure but replaces inline content with \`$ref\` links.

| Field | Type | Description |
|-------|------|-------------|
| \`openapi\` | string | OpenAPI version (e.g. \`"3.0.0"\`) |
| \`info.title\` | string | Human-readable title |
| \`info.domain\` | string | ONDC domain identifier (e.g. \`${domain}\`) |
| \`info.description\` | string | Domain description |
| \`info.version\` | string | Spec version (e.g. \`${version}\`) |
| \`info.usecases\` | string[] | List of supported use case IDs |
| \`info.branch-name\` | string | Source git branch name |
| \`security\` | array | Security scheme references |
| \`paths\` | \`{$ref: ./specs/openapi.yaml#/paths}\` | Reference to paths section in OpenAPI spec |
| \`components\` | \`{$ref: ./specs/openapi.yaml#/components}\` | Reference to components in OpenAPI spec |
| \`x-attributes\` | \`{$ref: ./attributes/index.yaml}\` | Reference to attribute definitions |
| \`x-validations\` | \`{$ref: ./validations/index.yaml}\` | Reference to validation rules |
| \`x-errors-codes\` | \`{$ref: ./errors/index.yaml}\` | Reference to error codes |
| \`x-supported-actions\` | \`{$ref: ./actions/index.yaml}\` | Reference to supported actions |
| \`x-flows\` | \`{$ref: ./flows/index.yaml}\` | Reference to flow definitions |
| \`x-docs\` | \`{$ref: ./docs}\` | Reference to extra documentation |

---

### \`config/specs/openapi.yaml\`
Complete OpenAPI 3.0 specification containing all API paths and component schemas. Referenced by \`index.yaml\` via JSON Pointer syntax: \`$ref: ./specs/openapi.yaml#/paths\` and \`$ref: ./specs/openapi.yaml#/components\`.

---

### \`config/flows/index.yaml\`
An ordered list of \`$ref\` entries, each pointing to a use-case sub-folder's index:
\`\`\`yaml
- $ref: ./<UseCase>/index.yaml
\`\`\`

### \`config/flows/<UseCase>/index.yaml\`
Playground manifest listing all flows for this use case:
\`\`\`yaml
flows:
  - type: playground
    id: <FlowId>
    tags: ["WORKBENCH", "PRAMAAN", "MANDATORY", "REPORTABLE"]
    description: <description from outputs flow.json>
    config:
      $ref: ./<FlowId>.yaml
\`\`\`

| Field | Type | Description |
|-------|------|-------------|
| \`type\` | string | Always \`playground\` |
| \`id\` | string | Flow identifier (matches file name) |
| \`tags\` | string[] | Labels from \`outputs/<domain>/<version>/<usecase>/<flowId>/flow.json\` |
| \`description\` | string | Description from \`flow.json\` |
| \`config.$ref\` | string | Relative path to the flow yaml |

### \`config/flows/<UseCase>/<FlowId>.yaml\`
Full transaction flow data extracted from \`x-flows\` in \`build.yaml\`. Key fields:

| Field | Type | Description |
|-------|------|-------------|
| \`meta.flowId\` | string | Unique flow identifier |
| \`meta.flowName\` | string | Human-readable flow name |
| \`meta.domain\` | string | Domain this flow belongs to |
| \`meta.description\` | string | Flow description |
| \`meta.use_case_id\` | string | Use case this flow is part of |
| \`steps\` | array | Ordered list of API call steps |
| \`steps[].api\` | string | API action (e.g. \`search\`, \`on_search\`) |
| \`steps[].owner\` | string | Who sends this call (\`BAP\` or \`BPP\`) |
| \`steps[].mock\` | object | Generate/validate functions + default payload |
| \`steps[].examples\` | array | Example payloads for this step |

---

### \`config/attributes/index.yaml\`
An ordered list of \`$ref\` entries pointing to per-use-case attribute files:
\`\`\`yaml
- $ref: ./UseCaseId1.yaml
- $ref: ./UseCaseId2.yaml
\`\`\`

### \`config/attributes/<UseCaseId>.yaml\`
Attribute definitions for a specific use case:

| Field | Type | Description |
|-------|------|-------------|
| \`meta.use_case_id\` | string | Use case identifier |
| \`attribute_set\` | object | Keyed by action name (e.g. \`search\`, \`on_search\`) |
| \`attribute_set.<action>.<path>._description\` | object | Leaf attribute descriptor |
| \`._description.required\` | boolean | Whether the attribute is required |
| \`._description.usage\` | string | Example value |
| \`._description.info\` | string | Description of the attribute |
| \`._description.owner\` | string | Who sets this field (\`BAP\`/\`BPP\`) |
| \`._description.type\` | string | Data type |
| \`._description.enums\` | array | Allowed enum values (if applicable) |

---

### \`config/validations/index.yaml\`
Validation rules keyed by action name. Each action holds an array of test groups.

| Field | Type | Description |
|-------|------|-------------|
| \`_TESTS_.<action>\` | array | List of test groups for an action |
| \`[].\_NAME_\` | string | Test group identifier |
| \`[].\_DESCRIPTION_\` | string | Human-readable description |
| \`[].\_RETURN_\` | array | Nested list of individual validation rules |
| \`rule.attr\` | string | JSONPath to the field being validated |
| \`rule.reg\` | string[] | Regex patterns the value must match |
| \`rule.valid\` | string[] | Exact allowed values |
| \`rule.\_CONTINUE_\` | string | Condition to skip this rule |
| \`rule.\_RETURN_\` | string | Assertion message |

---

### \`config/errors/index.yaml\`
Error codes for this domain:

| Field | Type | Description |
|-------|------|-------------|
| \`code\` | array | List of error code objects |
| \`code[].code\` | string | Numeric error code |
| \`code[].Event\` | string | Human-readable event description |
| \`code[].From\` | string | Who raises this error (\`BAP\`/\`BPP\`) |
| \`code[].Description\` | string | Where/how the error is used |

---

### \`config/actions/index.yaml\`
Supported actions and API orchestration properties:

| Field | Type | Description |
|-------|------|-------------|
| \`supportedActions\` | object | Maps each action to allowed next actions |
| \`apiProperties\` | object | Per-action async and transaction-partner metadata |
| \`apiProperties.<action>.async_predecessor\` | string\\|null | The action this is a response to |
| \`apiProperties.<action>.transaction_partner\` | string[] | Actions sharing the same transaction |

---

## Use Cases in this version

${usecaseList}
`;
}

async function processBuildYaml(
    buildYamlPath: string,
    domain: string,
    version: string,
): Promise<void> {
    const raw = readFileSync(buildYamlPath, "utf-8");
    const doc = parseYaml(raw) as Record<string, unknown>;

    const outBase = join(FORMATTED_CONFIGS_DIR, domain, version, "config");
    const versionBase = join(FORMATTED_CONFIGS_DIR, domain, version);
    ensureDir(outBase);

    const info = doc["info"] as Record<string, unknown> | undefined;
    const branchName = readBranchName(domain, version);
    const reporting = await fetchReporting(domain, version);

    // Collect unique use case IDs from x-attributes
    const attributes = doc["x-attributes"] as
        | Array<Record<string, unknown>>
        | undefined;
    const usecases: string[] = [];
    if (attributes && attributes.length > 0) {
        for (const attrSet of attributes) {
            const meta = attrSet["meta"] as Record<string, unknown> | undefined;
            const id = meta?.use_case_id as string | undefined;
            if (id && !usecases.includes(id)) usecases.push(id);
        }
    }

    // --- index.yaml: new format matching new-fromat/config/index.yaml schema ---
    const indexContent: Record<string, unknown> = {
        openapi: doc["openapi"] ?? "3.0.0",
        info: {
            title: info?.title ?? "",
            domain,
            description: info?.description ?? "",
            version,
            ...(usecases.length > 0 ? { usecases } : {}),
            ...(branchName ? { "branch-name": branchName } : {}),
            reporting,
        },
        security: doc["security"] ?? [],
        paths: { $ref: "./specs/openapi.yaml#/paths" },
        components: { $ref: "./specs/openapi.yaml#/components" },
        "x-attributes": { $ref: "./attributes/index.yaml" },
        "x-validations": { $ref: "./validations/index.yaml" },
        "x-errors-codes": { $ref: "./errors/index.yaml" },
        "x-supported-actions": { $ref: "./actions/index.yaml" },
        "x-flows": { $ref: "./flows/index.yaml" },
        "x-docs": { $ref: "./docs" },
    };
    writeFileSync(join(outBase, "index.yaml"), stringifyYaml(indexContent));

    // --- specs/openapi.yaml: paths + components only (the referenced sections) ---
    ensureDir(join(outBase, "specs"));
    const specContent: Record<string, unknown> = {
        openapi: doc["openapi"] ?? "3.0.0",
        info: doc["info"],
        security: doc["security"],
    };
    if (doc["paths"]) specContent["paths"] = doc["paths"];
    if (doc["components"]) specContent["components"] = doc["components"];
    writeFileSync(
        join(outBase, "specs", "openapi.yaml"),
        stringifyYaml(specContent),
    );

    // --- flows/<usecase>/<flowId>.yaml + flows/<usecase>/index.yaml + flows/index.yaml ---
    const flows = doc["x-flows"] as Array<Record<string, unknown>> | undefined;
    if (flows && flows.length > 0) {
        ensureDir(join(outBase, "flows"));

        // Group flows by use case
        const byUseCase = new Map<
            string,
            Array<{
                flowId: string;
                fileName: string;
                flow: Record<string, unknown>;
            }>
        >();
        for (const flow of flows) {
            const meta = flow["meta"] as Record<string, unknown> | undefined;
            const flowId =
                (meta?.flowId as string) ??
                (meta?.flowName as string) ??
                "flow";
            const usecase = (meta?.use_case_id as string) ?? "default";
            if (!byUseCase.has(usecase)) byUseCase.set(usecase, []);
            byUseCase.get(usecase)!.push({
                flowId,
                fileName: sanitizeFileName(flowId) + ".yaml",
                flow,
            });
        }

        // Top-level flows/index.yaml: $ref to each usecase/index.yaml
        const usecaseRefs: Array<Record<string, string>> = [];
        for (const [usecase, usecaseFlows] of byUseCase) {
            const usecaseDir = join(outBase, "flows", usecase);
            ensureDir(usecaseDir);

            // Write each flow yaml under flows/<usecase>/<flowId>.yaml
            const playgroundEntries: Array<Record<string, unknown>> = [];
            for (const { flowId, fileName, flow } of usecaseFlows) {
                writeFileSync(join(usecaseDir, fileName), stringifyYaml(flow));
                const meta = readFlowMeta(domain, version, usecase, flowId);
                playgroundEntries.push({
                    type: "playground",
                    id: flowId,
                    tags: meta.tags,
                    description: meta.description,
                    config: { $ref: `./${fileName}` },
                });
            }

            // Write flows/<usecase>/index.yaml
            writeFileSync(
                join(usecaseDir, "index.yaml"),
                stringifyYaml({ flows: playgroundEntries }),
            );

            usecaseRefs.push({ $ref: `./${usecase}/index.yaml` });
        }

        // Write flows/index.yaml
        writeFileSync(
            join(outBase, "flows", "index.yaml"),
            stringifyYaml(usecaseRefs),
        );
    }

    // --- attributes/<useCaseId>.yaml + attributes/index.yaml ---
    if (attributes && attributes.length > 0) {
        ensureDir(join(outBase, "attributes"));
        const attrRefs: Array<Record<string, string>> = [];
        for (const attrSet of attributes) {
            const meta = attrSet["meta"] as Record<string, unknown> | undefined;
            const useCaseId = (meta?.use_case_id as string) ?? "default";
            const fileName = sanitizeFileName(useCaseId) + ".yaml";
            writeFileSync(
                join(outBase, "attributes", fileName),
                stringifyYaml(attrSet),
            );
            attrRefs.push({ $ref: `./${fileName}` });
        }
        writeFileSync(
            join(outBase, "attributes", "index.yaml"),
            stringifyYaml(attrRefs),
        );
    }

    // --- validations/index.yaml ---
    const validations = doc["x-validations"];
    if (validations !== undefined) {
        ensureDir(join(outBase, "validations"));
        writeFileSync(
            join(outBase, "validations", "index.yaml"),
            stringifyYaml(validations),
        );
    }

    // --- errors/index.yaml ---
    const errorcodes = doc["x-errorcodes"];
    if (errorcodes !== undefined) {
        ensureDir(join(outBase, "errors"));
        writeFileSync(
            join(outBase, "errors", "index.yaml"),
            stringifyYaml(errorcodes),
        );
    }

    // --- actions/index.yaml ---
    const supportedActions = doc["x-supported-actions"];
    if (supportedActions !== undefined) {
        ensureDir(join(outBase, "actions"));
        writeFileSync(
            join(outBase, "actions", "index.yaml"),
            stringifyYaml(supportedActions),
        );
    }

    // --- README.md beside config/ ---
    writeFileSync(
        join(versionBase, "README.md"),
        generateReadme(domain, version, branchName, usecases),
    );

    console.log(`  Formatted: ${domain}/${version}`);
}

export async function formatAllBuilds(): Promise<void> {
    if (!existsSync(FINAL_OUTPUTS_DIR)) {
        console.error(
            `final-outputs directory not found at: ${FINAL_OUTPUTS_DIR}`,
        );
        return;
    }

    ensureDir(FORMATTED_CONFIGS_DIR);

    const domains = readdirSync(FINAL_OUTPUTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    for (const domain of domains) {
        const domainPath = join(FINAL_OUTPUTS_DIR, domain);
        const versions = readdirSync(domainPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

        for (const version of versions) {
            const buildYamlPath = join(domainPath, version, "build.yaml");
            if (!existsSync(buildYamlPath)) {
                console.warn(
                    `  Skipping ${domain}/${version}: no build.yaml found`,
                );
                continue;
            }
            try {
                await processBuildYaml(buildYamlPath, domain, version);
                return; // TEMP: process only the first one for testing
            } catch (err) {
                console.error(`  Error processing ${domain}/${version}:`, err);
            }
        }
    }

    console.log("Done formatting all builds.");
}
