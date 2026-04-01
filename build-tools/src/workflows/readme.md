# Workflows

GitHub Actions workflows for the ONDC spec pipeline. All workflows operate on the same `config/` directory convention and produce or consume `build.yaml` as the resolved artifact.

---

## Config directory convention

Every spec repository that uses these workflows must have a `config/` directory at its root with the following structure:

```
config/
  index.yaml              ← root manifest; all other files are referenced via $ref
  actions/
    index.yaml            ← x-supported-actions block
  attributes/
    index.yaml
    <use-case-id>.yaml    ← one attribute set per use case
  docs/
    overview.md
    references.md
    release-notes.md      ← markdown files auto-merged into x-docs
  errors/
    index.yaml            ← x-errorcodes block
  flows/
    index.yaml            ← flat list pointing to each flow file
    <use-case>/
      <FlowId>.yaml       ← one flow entry per file
  specs/
    openapi.yaml          ← OpenAPI 3.x spec (paths + components)
  validations/
    index.yaml            ← x-validations block
```

The `parse` command (`@ondc/build-tools parse`) resolves all `$ref` links recursively and merges everything into a single `build.yaml`.

---

## `build.yaml` structure

`build.yaml` is validated against the `BuildConfig` schema (`src/types/build-type.ts`). Top-level keys:

```yaml
openapi: "3.x.x"

info:
    domain: "ONDC:FIS10" # string — ONDC domain identifier
    version: "2.1.0" # string — spec version
    title: "..." # string (optional)
    description: "..." # string (optional)
    x-usecases: # string[] — all valid use-case IDs in this spec
        - gift-card
    x-branch-name: "main" # string (optional)
    x-reporting: true # boolean — whether this domain reports to the registry

paths: { ... } # OpenAPI 3.x paths object
components: { ... } # OpenAPI 3.x components (schemas, securitySchemes)

x-flows: # FlowEntry[]
    - type: playground
      id: "Buyer_App_Fulfilling_Code_On_Confirm"
      usecase: "gift-card" # must exist in info.x-usecases
      description: "..."
      tags: ["buyer", "confirm"]
      config: { ... } # MockPlaygroundConfig (validated by @ondc/automation-mock-runner)

x-attributes: # AttributeSet[]
    - meta:
          use_case_id: "gift-card"
      attribute_set:
          message:
              intent:
                  <attribute-path>:
                      required: true
                      type: "string"
                      usage: "..."
                      info: "..."
                      owner: "BAP"
                      enums: [] # optional — list of valid enum values
                      tags: [] # optional — AttributeTagEntry[]

x-errorcodes:
    code: # ErrorCodeEntry[]
        - code: "30000"
          Event: "search"
          Description: "..."
          From: "BPP"

x-supported-actions:
    supportedActions: # Record<action, nextActions[]>
        search: [on_search]
        on_search: []
    apiProperties: # Record<action, { async_predecessor, transaction_partner[] }>
        search:
            async_predecessor: null
            transaction_partner: [BPP]

x-validations: { ... } # domain-specific validation rules (schema is open)

x-docs: # Record<stem, markdownContent> — from docs/ directory
    overview: "..."
    references: "..."
    release-notes: "..."
```

### Key type constraints

| Field                                  | Type                            | Notes                                                                                                             |
| -------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `info.x-usecases`                      | `string[]`                      | Every flow's `usecase` and every attribute set's `meta.use_case_id` must match one of these                       |
| `x-flows[].config`                     | `MockPlaygroundConfig`          | Validated by `validateConfigForDeployment()` from `@ondc/automation-mock-runner`                                  |
| `x-attributes[].attribute_set`         | `Record<string, AttributeNode>` | Recursive — nodes are either nested maps or leaf `AttributeLeaf` objects (detected by presence of `required` key) |
| `x-errorcodes.code`                    | `ErrorCodeEntry[]`              | `code` field accepts string or number                                                                             |
| `x-supported-actions.supportedActions` | `Record<string, string[]>`      | Keys are action names; values are arrays of valid next actions                                                    |

---

## Workflows

---

### `spec-workflow.yml` — Spec CI Pipeline

**Trigger**: push to `main` or any `draft-*` branch when anything under `config/**` changes, or manual dispatch.

**What it does**:

```
config/          →  [parse]  →  build.yaml  →  [validate]  →  [gen-rag-table]  →  [push-to-db]
```

| Step               | Command                                                                             | Output                             | Notes                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Parse config       | `parse -i config -o build.yaml`                                                     | `build.yaml`                       | Resolves all `$ref`s into a single file                                            |
| Upload artifact    | actions/upload-artifact@v4                                                          | `build-artifact` (7-day retention) | Makes `build.yaml` downloadable from the Actions run                               |
| Validate           | `validate -i build.yaml`                                                            | —                                  | Schema check + semantic pipeline; fails the job on any error                       |
| Generate RAG table | `gen-rag-table -i build.yaml -o generated`                                          | `generated/raw_table.json`         | Flattens the config into rows for RAG / vector indexing                            |
| Push to DB         | `push-to-db -f build.yaml -t generated/raw_table.json -u $API_BASE_URL -k $API_KEY` | —                                  | Skipped on pull requests; requires `API_KEY` and optionally `API_BASE_URL` secrets |

**Required secrets**:

| Secret         | Required | Default                   | Description                                     |
| -------------- | -------- | ------------------------- | ----------------------------------------------- |
| `API_KEY`      | Yes      | —                         | Auth token for the config service push endpoint |
| `API_BASE_URL` | No       | `https://api.example.com` | Base URL of the config service                  |

**Artifact**: the parsed `build.yaml` is uploaded as `build-artifact` and retained for 7 days — useful for debugging or downloading the resolved config without running locally.

### `deploy-onix.yaml` — ONIX Deployment Workflow

**Trigger**: push to `draft-*` branch when anything under `config/**` changes, or manual dispatch.

**What it does**:

```
config/ →  [parse]  →  build.yaml  →  [validate]  →  [deploy-onix]

```

### `update-rags.yaml` — RAG Table Update Workflow

---

<!-- ADD NEW WORKFLOWS BELOW THIS LINE -->

<!--
### `<workflow-name>.yml` — <Short description>

**Trigger**: ...

**What it does**: ...

| Step | Command | Output | Notes |
|------|---------|--------|-------|

**Required secrets**: ...

---
-->

>
