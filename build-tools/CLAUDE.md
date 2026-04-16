# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run CLI with tsx (no build needed): npx tsx src/index.ts <cmd>
npm run build        # Compile TypeScript -> dist/
npm run typecheck    # Type-check without emitting
npm test             # Run all tests (Jest + ESM)
npm run test:watch   # Watch mode
npm run test:coverage
npm run format       # Prettier write
npm run format:check # Prettier check (CI)
```

Run a single test file:
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/store/ingest.test.ts
```

Use dev mode during development to avoid rebuilding:
```bash
npx tsx src/index.ts parse -i ../formatted-configs/ONDC:FIS10/2.1.0/config -o ./resolved/FIS10-2.1.0.yaml
```

## Architecture

This package has two distinct entry points:

- **CLI** (`src/index.ts`) — `ondc-tools` binary, registered via `bin` in package.json
- **Library** (`src/lib.ts`) — imported as `@ondc/build-tools`; re-exports types, diff functions, and the full store module

### CLI Commands

| Command | Source | Purpose |
|---|---|---|
| `parse` | `src/commands/merge.ts` | Resolve `$ref`-linked config dir → single `build.yaml` |
| `validate` | `src/commands/validate.ts` | Schema (Zod) + semantic validation pipeline |
| `gen-change-logs` | `src/commands/gen-change-logs.ts` | Diff two `build.yaml` files → changelog JSON |
| `gen-rag-table` | `src/commands/gen-rag-table.ts` | Flatten config → RAG rows for vector indexing |
| `push-to-db` | `src/commands/push-to-db.ts` | POST build + RAG table to config service API |
| `gen-md` | `src/commands/gen-markdowns.ts` | Generate markdown from build config (stub) |
| `make-onix` | `src/commands/make-onix.ts` | ONIX deployment (stub) |

### Core Data Flow

```
config/ (split YAML with $ref links)
  → parse → build.yaml (single flat file)
  → validate → schema check (Zod) + VALIDATION_PIPELINE
  → gen-rag-table → raw_table.json
  → push-to-db → config service API
```

### BuildConfig Schema

Defined in `src/types/build-type.ts` as a Zod schema. Key top-level fields: `info` (domain, version, x-usecases), `paths`, `components`, `x-flows`, `x-attributes`, `x-errorcodes`, `x-supported-actions`, `x-validations`, `x-docs`.

The `x-flows[].config` field is validated by `validateConfigForDeployment()` from `@ondc/automation-mock-runner`.

### Validation Pipeline

`src/validations/pipeline.ts` exports `VALIDATION_PIPELINE: ValidationCheck[]`. To add a new check: create `src/validations/validate-<name>.ts` exporting a `ValidationCheck`, then append it to `VALIDATION_PIPELINE`.

### MongoDB Store (`src/store/`)

Two sub-modules:
- `build-data/` — 6 collections for storing build configs (`build_meta`, `build_docs`, `build_flows`, `build_attributes`, `build_validations`, `build_changelog`)
- `validation-table/` — separate collection for RAG/validation rows

`ingestBuild()` is the main ingestion function: SHA-256 deduplication, diff against previous build, upsert + stale-doc cleanup, changelog insertion — all in one call.

### ESM Configuration

The package uses `"type": "module"` (ESM). All internal imports use `.js` extensions even for `.ts` source files (TypeScript ESM convention). Jest is run with `NODE_OPTIONS='--experimental-vm-modules'` and uses `@swc/jest` for transformation.

## Prettier Config

`semi: true`, `singleQuote: false`, `trailingComma: "all"`, `tabWidth: 4`, `printWidth: 100`.
