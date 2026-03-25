# @ondc/build-tools

CLI toolchain + library for managing ONDC build configs — parse, validate, diff, and ingest into MongoDB.

This package serves two roles:

1. **CLI** (`ondc-tools`) — used in CI/CD pipelines to resolve split configs, validate them, and generate changelogs.
2. **Library** (`@ondc/build-tools` + `@ondc/build-tools/store`) — imported by a DB service to ingest parsed configs into MongoDB.

---

## Requirements

- **Node.js >= 20**
- Built with TypeScript (ESM). Run `npm run build` before using the compiled binary, or use `npm run dev` during development.

---

## Installation

```bash
cd build-tools
npm install
npm run build
```

**Global binary via `npm link`**

```bash
npm link
ondc-tools parse -i ...
```

**Without linking**

```bash
npx ondc-tools parse -i ...
# or
node dist/index.js parse -i ...
# or (dev mode, no build needed)
npx tsx src/index.ts parse -i ...
```

> All examples below use the linked form (`ondc-tools ...`).

---

## CLI Commands

```
ondc-tools <command> [options]

Commands:
  parse           Resolve a split config directory into a single build.yaml
  validate        Validate a resolved build.yaml (schema + semantic checks)
  gen-change-logs Compare two build configs and produce a structured changelog
  make-onix       (coming soon)
```

### `parse`

Resolves a formatted config directory (with `index.yaml` and `$ref` links) into a single, flat `build.yaml`.

```bash
ondc-tools parse -i <config-dir> -o <output.yaml>
```

| Flag                  | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `-i, --input <path>`  | Path to the config directory that contains `index.yaml` |
| `-o, --output <path>` | Path to write the resolved `build.yaml`                 |

**Example**

```bash
ondc-tools parse \
  -i ../formatted-configs/ONDC:FIS10/2.1.0/config \
  -o ./resolved/FIS10-2.1.0.yaml
```

**How it works**

The config directory uses `$ref` links that `parse` resolves recursively:

- `./file.yaml` — inlined as parsed YAML
- `./file.yaml#/some/pointer` — specific key via JSON Pointer
- `./dir/` — `{ stem: content }` map from every `.md` file in the directory
- Array of `{ $ref: ... }` — resolved and flattened into a single array

---

### `validate`

Validates a resolved `build.yaml` in two stages:

1. **Schema validation** — checks against the `BuildConfig` Zod schema.
2. **Semantic pipeline** — runs domain-specific checks.

```bash
ondc-tools validate -i <build.yaml>
```

| Flag                 | Description                                 |
| -------------------- | ------------------------------------------- |
| `-i, --input <path>` | Path to the resolved build.yaml to validate |

**Semantic checks**

| Check          | What it verifies                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `usecase-ids`  | Every `x-flows[i].usecase` and `x-attributes[i].meta.use_case_id` is declared in `info["x-usecases"]` |
| `flow-configs` | Every flow's `config` block passes `validateConfigForDeployment()` from `@ondc/automation-mock-runner` |

**Adding a new check**: Create `src/validations/validate-<name>.ts`, export a `ValidationCheck`, and add it to the `VALIDATION_PIPELINE` array in `src/validations/pipeline.ts`.

---

### `gen-change-logs`

Compares two resolved build configs and produces a structured JSON changelog.

```bash
ondc-tools gen-change-logs --old <path> --new <path> [-o <output.json>]
```

| Flag           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| `--old <path>` | Path to the old resolved build.yaml                                  |
| `--new <path>` | Path to the new resolved build.yaml                                  |
| `-o <path>`    | Output JSON path (defaults to `changelog_<domain>_<version>_<date>.json`) |

**Diff sections**: info, flows, attributes, errors, actions, paths. Each section is capped at 100 entries with truncation metadata.

---

## Library Usage

Install in your service:

```bash
npm install @ondc/build-tools
```

### Types & schemas

```ts
import { BuildConfig } from "@ondc/build-tools";
import type { ChangeLog, ChangeSection } from "@ondc/build-tools";
```

`BuildConfig` is both a Zod schema (for parsing/validation) and a TypeScript type.

### MongoDB store module

```bash
# mongodb is a peer dependency — install it in your service
npm install mongodb
```

```ts
import { MongoClient } from "mongodb";
import { ingestBuild, createIndexes, COLLECTIONS } from "@ondc/build-tools/store";
import type { IngestResult, StoredBuildMeta } from "@ondc/build-tools/store";

const client = new MongoClient(process.env.MONGO_URI!);
const db = client.db("ondc");

// Run once at startup — idempotent
await createIndexes(db);

// Ingest a parsed build config
const result = await ingestBuild(db, parsedConfig);

if (result.skipped) {
    console.log("Build already ingested (identical hash).");
} else {
    console.log(`Ingested ${result.domain}@${result.version}`);
    console.log(`${result.changes} changes detected`);
}
```

### Store module API

#### `createIndexes(db: Db): Promise<void>`

Creates all required indexes across the 6 collections. Idempotent — safe to call on every startup.

#### `ingestBuild(db: Db, config: BuildConfig): Promise<IngestResult>`

Main entry point. Stores a `BuildConfig` split across collections:

1. Computes a SHA-256 `buildHash` of the full config.
2. **Skips** if the existing build has the same hash (idempotent).
3. Diffs against the existing build to produce a changelog.
4. Upserts meta, docs, flows, attributes, and validations.
5. Removes stale documents (e.g., deleted flows/docs).
6. Inserts the changelog entry.

#### `diffChangelog(db: Db, config: BuildConfig, existingMeta: StoredBuildMeta | null): Promise<StoredChangeLog | null>`

Produces a changelog by diffing against the previous build. Returns `null` on first ingestion (no previous build to diff against) or when there are zero changes.

### Collections

| Collection          | Key                              | Contents                         |
| ------------------- | -------------------------------- | -------------------------------- |
| `build_meta`        | `domain + version`               | Everything except sub-collections |
| `build_docs`        | `domain + version + slug`        | One per `x-docs` entry           |
| `build_flows`       | `domain + version + flowId`      | One per `x-flows` entry          |
| `build_attributes`  | `domain + version + useCaseId`   | One per `x-attributes` entry     |
| `build_validations` | `domain + version`               | `x-validations` blob             |
| `build_changelog`   | `domain + fromVersion + toVersion` | Diff between consecutive builds |

---

## Typical pipeline

```bash
# 1. Format a raw build.yaml into a split config directory (build-cleanser)
cd ../build-cleanser
npx tsx index.ts

# 2. Resolve the split config back into a single build.yaml
ondc-tools parse \
  -i ../formatted-configs/ONDC:FIS10/2.1.0/config \
  -o ./resolved/FIS10-2.1.0.yaml

# 3. Validate the resolved config
ondc-tools validate -i ./resolved/FIS10-2.1.0.yaml

# 4. Generate a changelog against the previous version
ondc-tools gen-change-logs \
  --old ./resolved/FIS10-2.0.0.yaml \
  --new ./resolved/FIS10-2.1.0.yaml
```

In your DB service, use the library to ingest the parsed config:

```ts
import { BuildConfig } from "@ondc/build-tools";
import { ingestBuild } from "@ondc/build-tools/store";

const raw = fs.readFileSync("resolved/FIS10-2.1.0.yaml", "utf-8");
const config = BuildConfig.parse(yaml.parse(raw));
const result = await ingestBuild(db, config);
```

---

## Development

```bash
npm run dev          # Run CLI with tsx (no build needed)
npm run build        # Compile TypeScript -> dist/
npm run typecheck    # Type-check without emitting
npm run format       # Format with Prettier
npm run format:check # Check formatting (CI-safe)
```

**Prettier config** (`.prettierrc.json`): `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `tabWidth: 4`, `printWidth: 100`.

---

## Project structure

```
src/
├── index.ts                        # CLI entry point (Commander)
├── lib.ts                          # Library entry point (types + diff functions)
├── commands/
│   ├── merge.ts                    # `parse` command
│   ├── validate.ts                 # `validate` command
│   ├── gen-change-logs.ts          # `gen-change-logs` command
│   └── make-onix.ts                # stub (coming soon)
├── types/
│   └── build-type.ts               # BuildConfig Zod schema + type exports
├── validations/
│   ├── types.ts                    # ValidationCheck, ValidationResult, ValidationIssue
│   ├── pipeline.ts                 # VALIDATION_PIPELINE + runValidationPipeline()
│   ├── validate-usecases.ts        # usecase-ids check
│   └── validate-flow-configs.ts    # flow-configs check
├── change-logs/
│   ├── types.ts                    # ChangeLog, ChangeSection, ChangeEntry
│   └── diff.ts                     # Six section diff functions
├── store/
│   ├── index.ts                    # Store barrel export
│   ├── schemas.ts                  # Stored document types (MongoDB)
│   ├── collections.ts              # Collection names + createIndexes()
│   ├── changelog.ts                # diffChangelog() — diffs against stored build
│   └── ingest.ts                   # ingestBuild() — main ingestion function
└── errors/
    └── NotImplementedError.ts
```
