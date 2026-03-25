# build-cleanser

Converts ONDC OpenAPI YAML files from the **old format** (separate `x-enum`, `x-tags`, `x-attributes` sections) into the **new format** (unified `x-attributes` array with enums/tags inlined at each leaf).

---

## CLI Commands

### Convert a build YAML

```bash
npx tsx index.ts convert
```

```bash
# Custom input/output paths
npx tsx index.ts convert -i config/build.yaml -o config/output.yaml
```

### Fetch flows

```bash
npx tsx index.ts flows
```

### Help

```bash
npx tsx index.ts --help
npx tsx index.ts convert --help
npx tsx index.ts flows --help
```

---

## Scripts

### Convert a build YAML (legacy)

```bash
npm run dev
```

Reads `config/build.yaml`, writes `config/output.yaml`.

---

### Build / update the knowledgebase

The knowledgebase (`knowledgebase.json`) stores attribute descriptions indexed by:

```
{domain}.{version}.{action}.{dotted.attribute.path}  →  "info string"
```

It accumulates entries from multiple new-format YAMLs over time so that when converting a new domain, placeholder `info` fields can be filled from known cross-domain data.

#### Run against a specific file

```bash
npx tsx scripts/build-knowledgebase.ts <path-to-new-build.yaml> [knowledgebase.json]
```

**Examples:**

```bash
# Index config/new.yaml into knowledgebase.json (default output path)
npx tsx scripts/build-knowledgebase.ts config/new.yaml

# Index config/new.yaml and write to a custom path
npx tsx scripts/build-knowledgebase.ts config/new.yaml data/knowledgebase.json

# Index multiple YAMLs — entries accumulate, existing keys are never overwritten
npx tsx scripts/build-knowledgebase.ts config/new.yaml
npx tsx scripts/build-knowledgebase.ts config/another-domain.yaml
```

Or via the npm shortcut (uses `knowledgebase.json` in the project root):

```bash
npm run kb config/new.yaml
npm run kb config/another-domain.yaml knowledgebase.json
```

#### Key format

| Part             | Source                                                  |
| ---------------- | ------------------------------------------------------- |
| `domain`         | `info.domain` (falls back to `info.title`)              |
| `version`        | `info.version`                                          |
| `action`         | key inside `attribute_set` (e.g. `search`, `on_search`) |
| `attribute.path` | dot-joined path to the `_description` leaf              |

Example key:

```
ONDC:FIS12.2.3.0.search.context.location.country.code
```

#### Behaviour

- **Never overwrites** existing keys — safe to run across many YAMLs repeatedly.
- Output is sorted alphabetically for stable git diffs.
- The file is plain JSON; commit it to source control so descriptions accumulate across domains and versions.

---

## Project structure

```
build-cleanser/
  index.ts                        # entry point
  convert.ts                      # YAML read → transform → write pipeline
  types.ts                        # shared OpenAPI primitives
  services/
    attributeConverted.ts         # old → new attribute conversion logic
  types/
    old-build.ts                  # old format types
    new-build.ts                  # new format types
  scripts/
    build-knowledgebase.ts        # knowledgebase builder script
  config/
    build.yaml                    # primary input (old format)
    new.yaml                      # reference new-format YAML
    old.yaml                      # reference old-format YAML
    output.yaml                   # generated output
  knowledgebase.json              # cross-domain attribute description index
```
