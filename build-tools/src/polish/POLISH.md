# `polish` — Reference

Comprehensive reference for the `polish` command and its attribute-mining pipeline. Primary audience: engineers maintaining/extending `src/polish/`.

> All file:line citations point into this repo at the time of writing. Line numbers drift — treat them as anchors, not contracts.

---

## 1. What `polish` does

Turns an **incomplete split-config** (missing/stub attribute descriptions, stub flow narratives, stub overview) into a **gold-standard documented split-config** via a phased LLM-assisted pipeline with human review.

### Data flow

```
split-config/ (index.yaml + $ref fragments, with stubs)
        │
        ▼
   merge → BuildConfig (in-memory)
        │
        ▼
   ┌─── POLISH_PIPELINE (16 steps) ───┐
   │  scaffold                        │
   │  overview-{detect,questions,…}   │
   │  attributes-{detect,mine,dedup,  │
   │    preview-prompts,draft,        │
   │    review,write}                 │
   │  flows-{detect,draft,review,     │
   │    write}                        │
   └──────────────────────────────────┘
        │
        ▼
output/ (docs/overview.md + attributes/*.yaml + flows/* + .polish/)
        │
        ▼
   parse → build.yaml  (downstream)
```

### CLI

Entry point: `src/commands/polish.ts:21`.

```bash
npx tsx src/index.ts polish \
  -i path/to/split-config \
  -o path/to/output \
  [--phase overview|attributes|flows|all] \
  [--provider anthropic|openai-compat|claude-code] \
  [--model <id>] [--api-key <key>]
```

Phase filter (`src/commands/polish.ts:190`): `scaffold` always runs; other steps are gated by prefix match on `--phase`.

### Outputs

- `output/docs/overview.md` — domain overview
- `output/attributes/<usecase>.yaml` — per-usecase attribute trees
- `output/attributes/index.yaml` — `$ref` index of the above
- `output/.polish/` — debug artefacts (see §10)

---

## 2. Pipeline structure

`src/polish/pipeline.ts:28` exports the ordered list:

| # | Step id | Phase |
|---|---|---|
| 1 | scaffold | always |
| 2–5 | overview-detect, overview-questions, overview-compose, overview-write | overview |
| 6–12 | **attributes-detect, attributes-mine, attributes-dedup, attributes-preview-prompts, attributes-draft, attributes-review, attributes-write** | attributes |
| 13–16 | flows-detect, flows-draft, flows-review, flows-write | flows |

### `PolishContext` (`src/polish/types.ts:5`)

```ts
type PolishContext = {
  inputDir: string;
  outputDir: string;
  config: BuildConfig;       // parsed input
  llm: ILLMProvider;
  ui: ConsoleUI;
  state: Record<string, unknown>;  // shared scratchpad
};
```

Steps communicate exclusively through `ctx.state`. Keys used by attribute mining:

| Key | Producer | Type |
|---|---|---|
| `attributeGaps` | detect | `AttributeGap[]` |
| `attributeGapsGrouped` | detect | `Map<uc, Map<action, AttributeGap[]>>` |
| `attributeObservations` | detect | `LeafObservation[]` |
| `attributeBundles` | mine | `Map<uc, Map<action, ContextBundle[]>>` |
| `attributeDedupGroups` | dedup | `DedupGroup[]` |
| `flowsPerAction` | dedup | `Map<action, number>` |
| `attributeDrafts` | draft | `Map<uc, Map<action, LeafDraft[]>>` |
| `approvedDrafts` | review | `Map<"uc::action::path", LeafDraft>` |

---

## 3. Attribute mining (primary section)

Seven steps. Each consumes from and writes to `ctx.state`; debug artefacts go under `output/.polish/`.

### 3.1 `attributes-detect`

`src/polish/steps/attributes-detect.ts:13`.

**Purpose** — find which observed attributes lack adequate documentation in the existing `x-attributes`.

**Algorithm**

1. `walkFlowsForObservations(config)` (`attributes/walker.ts`) walks every flow's payloads (`mock.defaultPayload`, examples) → `LeafObservation[]`. Each observation records `(ucId, action, path[], pathKey, valueType, sampleValues, mostCommonValue, isLeaf, seenInFlows, isArrayIndexed)`.
2. Root observations (`pathKey === ""`) are dropped — they describe the message envelope, not an attribute.
3. For each non-root observation, `lookupExistingLeaf(sets, ucId, path)` (`attributes/placeholder.ts:84`) walks `config["x-attributes"]` to find a prior `_description` leaf.
4. `isIncompleteLeaf(leaf, leniency)` (`attributes/placeholder.ts:46`) classifies the leaf. Leniency levels (`attributes/placeholder.ts:33`):

   | Leniency | Re-generate when… |
   |---|---|
   | `strict` | leaf is missing or all of `info/usage/owner/type` are empty |
   | `normal` | any of those four required fields is empty |
   | `lenient` (default) | any required field empty, OR `info`/`usage`/`owner` is a placeholder marker, OR `info.length < 15` |

   Placeholder markers (`attributes/placeholder.ts:3`): `edit later`, `edit-later`, `tbd`, `tba`, `--`, `<auto>`, `please add relevant description`.

5. `POLISH_FORCE_ALL_GAPS=1` forces every observation to be treated as a gap (`attributes-detect.ts:24`).
6. `POLISH_ATTR_LIMIT=N` caps the gap count for test runs (`attributes-detect.ts:90`).
7. Gaps are grouped into `Map<ucId, Map<action, AttributeGap[]>>`.

**Outputs**

- `ctx.state.attributeGaps`, `attributeGapsGrouped`, `attributeObservations`
- `.polish/attributes-detect-debug.json` — per-observation decision log (`isGap`, `reason ∈ {force_all, no_existing_leaf, incomplete_existing_leaf, complete_existing_leaf_filtered}`, existing leaf if any)

`AttributeGap` (`attributes-detect.ts:8`):
```ts
type AttributeGap = { obs: LeafObservation; existingLeaf: Record<string, unknown> | null };
```

### 3.2 `attributes-mine`

`src/polish/steps/attributes-mine.ts:16`.

**Purpose** — for each gap, build a `ContextBundle` of mined evidence the LLM can use to write a description.

**Algorithm** — iterates `(uc, action)` pairs; for each, calls `buildBundles(config, observations, onProgress)` from `attributes/mine-context.ts`. Five mining sources:

1. **OpenAPI metadata** (`attributes/openapi-lookup.ts`)
   - Walks `config.paths["/<action>"].requestBody.content["application/json"].schema`.
   - Resolves `$ref`, `allOf`, `oneOf`, `anyOf` combinators at each segment.
   - Returns `{ description, customDescription, type, enumValues }`. `customDescription` is the OpenAPI `_description` extension object.

2. **Code references** (`attributes/code-analyzer.ts` + `attributes/reference-scanner.ts`)
   - Base64-decodes `mock.generate`, `mock.validate`, `mock.requirements` for each step.
   - `analyzeSource()` parses via Babel (unambiguous mode, error-recovery), walks property accesses, tracks variable-to-prefix bindings from destructuring, classifies each access as `read | write | delete`, captures the gating predicate (enclosing `if` condition) for writes.
   - `scanCommentsOnly()` separately scans JSDoc text for path mentions.
   - `suffixMatches()` performs fuzzy matching: an observed path matches a code chain if it's a suffix (handles destructuring, optional chaining, snake_case/camelCase variants).
   - Hits capped at 8 per attribute. Each `ReferenceHit` = `{ flowId, actionId, kind: "generate"|"validate"|"requirements"|"comment"|"alias", snippet, matchedChain, role?, gatedBy? }`.

3. **SaveData hits** (`attributes/reference-scanner.ts` — `scanSaveData()`)
   - Walks each step's `mock.saveData` object.
   - Records `{ flowId, actionId, key, jsonpath, inherited?, ancestorJsonpath? }`.
   - `inherited: true` when an ancestor jsonpath was persisted, and the current attribute is a descendant.

4. **Session reads**
   - Built via a session-producer map: scan all steps under an action, map `saveData` keys → producing step.
   - When code accesses a known session key, emits a `SessionReadHit` with `{ sessionKey, snippet, originAction?, originPath?, originFlow? }` — value provenance.

5. **Cross-flow signals** (`CrossFlowSignals`)
   - `setInGenerate` ∧ `assertedInValidate` → round-trip pattern (BAP-mints/BPP-echoes).
   - `persistedKey` ∧ `consumedAcrossSteps` → session-anchored, reused downstream.

**Existing leaf** — prior `enums` and `tags` from `x-attributes` are carried forward verbatim (the LLM never produces them; see §3.5 `applyExisting`).

**Outputs**

- `ctx.state.attributeBundles` = `Map<uc, Map<action, ContextBundle[]>>`
- `.polish/attributes-detected/<uc>__<action>.json` — full bundle dump per (uc, action)
- `.polish/attributes-mine-timings.log` — TSV of per-attribute elapsed-ms

`ContextBundle` (`attributes/types.ts:87`):
```ts
{
  obs: LeafObservation;
  openapi: OpenApiMetadata | null;
  refs: ReferenceHit[];
  saveData: SaveDataHit[];
  sessionReads?: SessionReadHit[];
  existing: ExistingLeafInfo | null;
  crossFlow?: CrossFlowSignals;
}
```

### 3.3 `attributes-dedup`

`src/polish/steps/attributes-dedup.ts:27`. Backed by `attributes/dedup.ts`.

**Purpose** — collapse attributes that share evidence so the LLM is called once per equivalence class. Typically saves 30–80% of LLM calls.

**Grouping key** = `(signature, refFingerprint)`:

- **`computeSignature(b)`** (`dedup.ts:27`) — SHA-256 (truncated 16) of `{ pathKey, valueType, isLeaf, openapi: {description, custom, type}, existingEnums: codes[], existingTags: shape }`.
- **`computeRefFingerprint(b)`** (`dedup.ts:45`) — SHA-256 of `{ refKinds (sorted unique), saveTails (last 2 jsonpath segments, sorted unique) }`.

Two attributes hash to the same group iff their shape, spec text, and reference *pattern* match.

**Derived helpers (used at draft cloning time)** — `dedup.ts:53`:

| Helper | Logic |
|---|---|
| `deriveOwner(action)` | `"BPP"` if action starts with `on_`, else `"BAP"` |
| `deriveRequired(b, totalFlowsForAction)` | `obs.seenInFlows.length >= totalFlowsForAction` |
| `deriveUsage(b)` | `mostCommonValue` else first non-null sample (JSON-stringified if not string) |
| `deriveType(b)` | `"enum"` if existing enums; `"object"` if `!isLeaf`; ISO-8601 sample → `"date-time"`; else `obs.valueType` or `"string"` |

`flowsPerAction` (count of flows touching each action) is precomputed in `attributes-dedup.ts:9` for `deriveRequired`.

**Outputs**

- `ctx.state.attributeDedupGroups: DedupGroup[]` — each `{ signature, refFingerprint, representative: ContextBundle, members: BundleRef[] }`
- `ctx.state.flowsPerAction`
- `.polish/attributes-dedup-groups.json` — group summary + savings %

### 3.4 `attributes-preview-prompts`

`src/polish/steps/attributes-preview-prompts.ts:11`.

**Purpose** — pure audit step. Writes the exact LLM prompt that *would* be sent for each dedup group, so reviewers can inspect/diff prompts without running the model.

**Outputs**

- `.polish/llm-prompts/<slug>.txt` — one file per group
- `.polish/llm-prompts/_index.tsv` — searchable index (slug, signature, pathKey, member count)

### 3.5 `attributes-draft` *(critical)*

`src/polish/steps/attributes-draft.ts:25`. Backed by `attributes/draft.ts`.

**Purpose** — call the LLM once per dedup group, clone the result to all members, route attributes lacking evidence into the **paraphrase queue** (§6).

**Pipeline (per group, concurrency = `getConcurrency()`, default 8, cap 64)**

1. `itemToLLMInput(item)` (`draft.ts:109`) shapes the `ContextBundle` into a structured JSON payload (`LLMInputAttr`): path, action, openapi, existing enums/tags/leaf, referenced_in (refs with role/gated_by), save_data (with inherited flag), session_reads, gated_writes (derived shortlist of gated writes), most_common_value, cross_flow.
2. `buildPrompt([input], retryReason)` (`draft.ts:185`) assembles the full prompt. Structure:
   - Role + audience framing ("ONDC protocol documentation writer", "partner integrator")
   - OUTPUT constraints (plain text, 1–2 sentences preferred, up to 7; no JSON/markdown/quotes; **only the `info` string** — enums/tags/type/required/usage/owner are filled in automatically)
   - ACTION-AWARE FRAMING (BAP-side vs BPP-side; round-trip; session-anchored)
   - CONTAINER RULE (`is_leaf: false` → one sentence about the container's role; do not enumerate children)
   - EVIDENCE PRECEDENCE (8 tiers, see below)
   - Sentinel rule: *"If tiers 1–7 carry no signal, output EXACTLY `<no-enough-data>`"*
   - FORBIDDEN list (no path restatement, no quoting samples, no invented constraints, no boilerplate, no sentinel alternatives)
   - EXAMPLES (transaction_id, fulfillments, items.price.value with gating)
   - INPUT JSON

   Evidence tiers (higher wins on conflict):

   | Tier | Source |
   |---|---|
   | 1 | `openapi.description` / `openapi.custom` |
   | 2 | `existing_leaf.info` |
   | 3 | `referenced_in` (with `role`, `gated_by`) |
   | 4 | `save_data` (inherited persistence) |
   | 5 | `session_reads` (`origin_action`, `origin_path`) |
   | 6 | `gated_writes` (derived shortlist) |
   | 7 | `cross_flow` |
   | 8 | `sample_values` / `most_common_value` (illustrative only, never primary) |

3. `llm.complete([{ role: "user", content: prompt }])`. `parseDraftText(raw)` (`draft.ts:250`) tolerates code fences and surrounding quotes; preserves the literal `<no-enough-data>` token.
4. **Retry policy** (`draft.ts:4`) — 1 retry on error, prompt re-issued with `PREVIOUS ATTEMPT FAILED: <reason>` appended. Final failure → `dummyDraft()` (`draft.ts:339`) producing an `info: "AUTO-FALLBACK (LLM failure: …)…"` placeholder that the confidence scorer pins to 0 (§3.6).
5. `applyExisting()` (`draft.ts:303`) overlays carried-forward `enums`/`tags` from the existing leaf onto the draft. Sets `draft.type = "enum"` when enums present.
6. **Cloning** (`attributes-draft.ts:132`) — the representative draft is cloned to every member of the dedup group, with `owner / required / usage / type` re-derived per member (via the `derive*` helpers).
7. **Sentinel routing** (`attributes-draft.ts:147`) — if the representative's `info === NO_DATA_SENTINEL`, the (path, action, member-drafts) tuple is pushed into the paraphrase controller.
8. **Slot backfill** (`attributes-draft.ts:181`) — any unfilled slot (shouldn't happen normally) is filled with an `AUTO-FALLBACK` draft so downstream steps see a complete `LeafDraft[]`.

**Outputs**

- `ctx.state.attributeDrafts`
- Live UI events: ✓ ok / ↻ retry / ✗ dummy fallback per group, plus inflight/retry/fallback tallies
- Paraphrase server lifecycle: lazy-start, drafting-done signal, `waitForFinalize()` block, shutdown (§6)

### 3.6 `attributes-review`

`src/polish/steps/attributes-review.ts:9`. Backed by `review/confidence.ts` + `review/server.ts`.

**Purpose** — score each draft; auto-approve high-confidence drafts; spawn a web UI for the rest.

**Confidence scoring** — `scoreAttributeDraft(bundle, draft)` (`review/confidence.ts:27`). Additive factors:

| Factor | Weight |
|---|---|
| `AUTO-FALLBACK` info (LLM failure) | **score = 0** (short-circuit) |
| `openapi.description` present | +0.25 |
| `openapi.customDescription` present | +0.15 |
| `existing.enums` carried + `draft.enums` non-empty | +0.15 |
| `existing.tags` carried + `draft.tags` non-empty | +0.15 |
| `refs.length >= 3` | +0.20 (else `min(0.15, refs * 0.05)`) |
| `saveData.length >= 1` | +0.10 |
| `sampleValues.length >= 3` | +0.10 |
| `crossFlow.setInGenerate && assertedInValidate` | +0.10 |
| `crossFlow.persistedKey && consumedAcrossSteps` | +0.05 |
| `info.length >= 80` | +0.10 |
| `info` shares ≥2 ≥4-letter tokens with evidence (OpenAPI + prior leaf) | +0.05 |

Clamped to `[0, 1]`. Auto-approval threshold: `getConfidenceThreshold()` reads `POLISH_CONFIDENCE` (default **0.8**, `review/confidence.ts:5`).

**Review UI** — `runReviewServer({ kind: "attributes", session, writeBack, ui, llm })` opens a local HTTP server (`review/server.ts`) serving an HTML/JS UI from `review/static/`. Users toggle `approved`, edit draft fields, save changes. API endpoints include `/api/session` (GET/POST) and `/api/paraphrase` (LLM-backed rewrite of user text).

**Outputs**

- `ctx.state.approvedDrafts: Map<"uc::action::path", LeafDraft>`
- `.polish/attributes-review/<uc>__<action>.json` — per-file review state (pre-approved snapshot + final state)

### 3.7 `attributes-write`

`src/polish/steps/attributes-write.ts:9`. Backed by `attributes/merge-edits.ts`.

**Purpose** — merge approved drafts into per-usecase attribute YAML files.

**Algorithm**

1. Bucket approved drafts by usecase (split on `"::"`).
2. For each usecase, `mergeDraftsIntoAttributeSet(existing, ucId, observations, drafts)`:
   - Starts from the existing `attribute_set` (preserves untouched leaves).
   - Ensures every path from `observations` exists in the tree (creates empty container nodes as needed).
   - Overlays approved drafts at their leaf positions.
3. Writes `output/attributes/<uc_slug>.yaml` and `output/attributes/index.yaml` (`$ref` index).

---

## 4. Module reference (`src/polish/attributes/`)

| File | Role |
|---|---|
| `types.ts` | All attribute-side types. Key shapes: `LeafObservation`, `ReferenceHit`, `SessionReadHit`, `SaveDataHit`, `CrossFlowSignals`, `OpenApiMetadata`, `ExistingLeafInfo`, `ContextBundle`, `BundleRef`, `DedupGroup`, `LeafDraft`, `EnumEntry`, `TagEntry`, `ConfidenceScore`, `ReviewEntry`, `ReviewFile`. |
| `walker.ts` | `walkFlowsForObservations(config)` — walks every flow's payload tree, emits one `LeafObservation` per `(uc, action, path)`. Tracks distinct sample values (capped), sample counts (uncapped), `mostCommonValue`, `seenInFlows`, `isArrayIndexed`. Dedup key: `${uc}::${action}::${pathKey}`. |
| `mine-context.ts` | `buildBundles(config, observations, onProgress)` — orchestrates the 5 mining sources. Builds a session-producer map per action so reads can be resolved to their originating step. Calls `onProgress({pathKey, elapsedMs, done, total})` per attribute. |
| `code-analyzer.ts` | `analyzeSource(src): AnalyzedCode` — Babel parse + traverse. Builds variable→prefix bindings from callback destructuring, then walks property accesses recording `{segments, role: read|write|delete, gatedBy?}`. Returns access records + set of session keys read. Cached per source hash. |
| `reference-scanner.ts` | Fuzzy code-scanning helpers. `scanCommentsOnly(src)` for JSDoc-only matches. `scanSaveData(saveDataObj)` for session-key persistence. `suffixMatches(needle, haystack)` for case-variant suffix matching (handles destructuring, optional chaining). |
| `openapi-lookup.ts` | `lookupOpenApi(config, action, segments)` — walks `paths[/action].requestBody.content[application/json].schema` segment-by-segment, resolves `$ref`/`allOf`/`oneOf`/`anyOf` at each step. Handles numeric segments (array items) vs string segments (object props). |
| `placeholder.ts` | `resolveLeniency()`, `isIncompleteLeaf(leaf, leniency)`, `lookupExistingLeaf(sets, ucId, path)`. Placeholder marker set defined at the top of the file. |
| `dedup.ts` | `computeSignature`, `computeRefFingerprint`, `groupBundles`, `deriveOwner`, `deriveRequired`, `deriveUsage`, `deriveType`. ISO-8601 regex at line 71 promotes string samples to `"date-time"`. |
| `draft.ts` | Prompt construction (`buildPrompt`), input shaping (`itemToLLMInput`), LLM call wrapper (`draftLeaves` → `draftOneWithRetry`), `NO_DATA_SENTINEL` literal, `parseDraftText` (tolerates fences/quotes), `paraphraseUserDescription` (user-text rewrite endpoint), `applyExisting` (carry-forward enums/tags), `dummyDraft` (LLM-failure fallback). |
| `merge-edits.ts` | `mergeDraftsIntoAttributeSet(existing, ucId, observations, drafts)` — tree merge that preserves existing leaves and ensures all observation paths exist. |
| `base64.ts` | `decodeBase64(s)` utility used by `code-analyzer.ts` to decode mock code. |

---

## 5. Data lifecycle of a single attribute

```
   walker                  detect                       mine
LeafObservation  ───►  AttributeGap        ───►  ContextBundle
                       (incomplete?)              (evidence)
                                                       │
                                                       ▼ dedup
                                                  DedupGroup
                                                  (members[])
                                                       │
                                                       ▼ draft (LLM × 1 per group)
                                                  LeafDraft
                                                  (cloned to members,
                                                   derive owner/req/usage/type
                                                   per-member)
                                                       │
                                            ┌──────────┴──────────┐
                                            │                     │
                                  info === NO_DATA           normal draft
                                            │                     │
                                            ▼                     ▼
                                  paraphrase queue          confidence score
                                  (browser UI →                   │
                                   user text →            ≥ threshold? auto-approve
                                   LLM polish)            else web review
                                            │                     │
                                            └──────────┬──────────┘
                                                       ▼ write
                                          merged into attribute_set tree
                                          → output/attributes/<uc>.yaml
```

Map key for `approvedDrafts`: `${usecase}::${action}::${pathKey}`.

---

## 6. The paraphrase queue (insufficient evidence)

Recent feature. Handles attributes where the LLM cannot generate a description from the mined evidence and returns the literal sentinel `<no-enough-data>` (`attributes/draft.ts:248`).

### Why a sentinel?

Empty strings, "no data available", or LLM apologies would be ambiguous. The sentinel is a stable, unambiguous signal that *routes the attribute through a different UI* — the user describes it manually, and the LLM only polishes the wording.

### Trigger

`steps/attributes-draft.ts:147`:

```ts
if (infoText === NO_DATA_SENTINEL) {
  sentinelSeen++;
  paraphrase.push({ path: repPath, action: u.group.members[0]!.action, drafts: memberDrafts });
}
```

The (already-cloned) member drafts are passed in so the paraphrase result can be applied to every member of the dedup group at once.

### Controller

`createParaphraseController(llm, ui)` (`review/paraphrase-server.ts:137`) returns:

```ts
type ParaphraseQueueController = {
  push(task): void;                          // enqueue + lazy-start server
  setProgress({unitsDone, unitsTotal}): void; // live drafting status for UI
  setDraftingDone(): void;                    // signals "all drafting done; you can wrap up"
  waitForFinalize(): Promise<void>;           // resolves when user clicks "Continue to review"
  shutdown(): Promise<void>;
};
```

### Server lifecycle

1. **Lazy start** — first `.push()` starts a local HTTP server on a preferred port; falls back to a random free port if EADDRINUSE (`paraphrase-server.ts:77`). Binds to `127.0.0.1`.
2. **Browser open** — platform-aware: `open` on macOS, `cmd /c start` on Windows, `xdg-open` on Linux (`paraphrase-server.ts:102`).
3. **Host check** — every request must have `Host: 127.0.0.1:<port>` or `localhost:<port>`; else 403 (`paraphrase-server.ts:30`).
4. **API surface**:
   - `GET /` → `paraphrase.html` (UI shell)
   - `GET /static/...` → static assets
   - `GET /api/queue` → drafting status + task list (id, path, action, status, info, userText, error)
   - `POST /api/paraphrase {id, userText}` → calls `paraphraseUserDescription(llm, ...)` and updates the task

### `paraphraseUserDescription` prompt

`attributes/draft.ts:260`. Same role framing as the main prompt; rewrites the developer's note into a 1–2 sentence ONDC-style description for the specific `(path, action)`. No evidence tiers — the user's note *is* the evidence.

### Synchronisation with drafting

Drafting (concurrency 8 by default) **never blocks** on the paraphrase queue. The flow is:

1. Drafting runs in parallel with paraphrasing.
2. After every group finishes, `paraphrase.setProgress(...)` updates the UI's drafting-progress bar.
3. After the last group, `paraphrase.setDraftingDone()` flips the UI into "you can finalize now" mode.
4. `await paraphrase.waitForFinalize()` blocks until the user clicks "Continue to review" in the browser (`attributes-draft.ts:178`).
5. `paraphrase.shutdown()` closes the server.

If no sentinel was ever pushed, `setDraftingDone()` + `waitForFinalize()` are no-ops (server never started).

---

## 7. Supporting modules

### `src/polish/review/`

| File | Role |
|---|---|
| `types.ts` | `ReviewSession = AttributesReviewSession \| FlowsReviewSession`. |
| `confidence.ts` | `scoreAttributeDraft` (§3.6), `scoreFlowDescription` (text-shape + domain-signal scoring), `getConfidenceThreshold` (`POLISH_CONFIDENCE`, default 0.8). |
| `concurrency.ts` | `getConcurrency()` (`POLISH_CONCURRENCY`, default 8, cap 64), `runWithConcurrency(items, limit, worker, onProgress?)` — order-preserving bounded-parallel runner. |
| `server.ts` | Generic review HTTP server (used by both attributes-review and flows-review). Serves UI + JSON API; calls `writeBack(session)` on save. |
| `paraphrase-server.ts` | The browser UI server for the sentinel queue (§6). |
| `static/` | HTML/CSS/JS bundle for review + paraphrase UIs. |

### `src/polish/flows/`

| File | Role |
|---|---|
| `types.ts` | `FlowStepRef`, `FlowLevelRef`, `FlowDraft`, `FlowReviewEntry`, `FlowReviewFile`, `FlowConfidenceScore`. |
| `context.ts` | `collectFlowRefs()`, `collectStepRefs()` — gather flow/step metadata, filter to entries needing description drafts. |
| `detect.ts` | Flow-side gap detection helpers (mostly integrated into `steps/flows-detect.ts`). |
| `draft.ts` | LLM prompt construction for flow/step descriptions (narrative-style; emphasises how steps connect and what data flows between them). |

Flow steps (`steps/flows-*.ts`) mirror the attribute pipeline at a coarser grain: detect → draft → review → write. The flow phase reuses `runWithConcurrency`, `runReviewServer`, `scoreFlowDescription`. `POLISH_FLOW_LIMIT=N` caps for test runs (`src/commands/polish.ts:108`).

### Overview steps (`steps/overview-*.ts`)

| Step | Role |
|---|---|
| `overview-detect.ts` | Sets `state.overviewGap` if `docs/overview.md` is missing/stub. Downstream overview steps skip when false. |
| `overview-questions.ts` | LLM generates clarifying questions about the domain from the config. |
| `overview-compose.ts` | LLM composes overview markdown from config + question answers. |
| `overview-write.ts` | Writes `output/docs/overview.md`. |

---

## 8. Complete file map

```
src/commands/polish.ts                       CLI entry (createPolishCommand)

src/polish/
├── types.ts                                 PolishContext, PolishStep
├── pipeline.ts                              POLISH_PIPELINE (16-step array)
├── ui.ts                                    ConsoleUI: spinner, beginStep/endStep, stat/note/path
├── POLISH.md                                ← this file
│
├── steps/
│   ├── scaffold.ts                          create output directory tree
│   ├── overview-detect.ts                   stub-detect docs/overview.md
│   ├── overview-questions.ts                LLM-generate clarifying questions
│   ├── overview-compose.ts                  LLM-draft overview body
│   ├── overview-write.ts                    write docs/overview.md
│   ├── attributes-detect.ts                 find incomplete leaves → gaps (§3.1)
│   ├── attributes-mine.ts                   build ContextBundle per gap (§3.2)
│   ├── attributes-dedup.ts                  collapse by (signature, refFingerprint) (§3.3)
│   ├── attributes-preview-prompts.ts        dump exact prompts for audit (§3.4)
│   ├── attributes-draft.ts                  LLM draft + paraphrase queue (§3.5)
│   ├── attributes-review.ts                 confidence scoring + review UI (§3.6)
│   ├── attributes-write.ts                  merge + emit YAML (§3.7)
│   ├── flows-detect.ts                      collect flows/steps needing descriptions
│   ├── flows-draft.ts                       LLM-draft flow + step descriptions
│   ├── flows-review.ts                      review UI for flow descriptions
│   └── flows-write.ts                       emit updated flow files
│
├── attributes/
│   ├── types.ts                             all attribute-side types
│   ├── walker.ts                            walkFlowsForObservations
│   ├── mine-context.ts                      buildBundles (5 evidence sources)
│   ├── code-analyzer.ts                     Babel AST analysis of mock JS
│   ├── reference-scanner.ts                 fuzzy code-chain matching
│   ├── openapi-lookup.ts                    OpenAPI schema walker
│   ├── placeholder.ts                       leniency + isIncompleteLeaf
│   ├── dedup.ts                             signature + refFingerprint + derive helpers
│   ├── draft.ts                             prompt + NO_DATA_SENTINEL + paraphraseUserDescription
│   ├── merge-edits.ts                       mergeDraftsIntoAttributeSet
│   └── base64.ts                            decodeBase64 utility
│
├── flows/
│   ├── types.ts                             flow-side types
│   ├── context.ts                           collectFlowRefs / collectStepRefs
│   ├── detect.ts                            flow-gap helpers
│   └── draft.ts                             flow/step prompt construction
│
└── review/
    ├── types.ts                             ReviewSession union
    ├── confidence.ts                        scoreAttributeDraft + scoreFlowDescription
    ├── concurrency.ts                       runWithConcurrency + getConcurrency
    ├── server.ts                            generic review HTTP server
    ├── paraphrase-server.ts                 sentinel-queue browser UI server
    └── static/                              UI assets (HTML/CSS/JS)
```

---

## 9. Env var reference

| Var | Default | Used by | Effect |
|---|---|---|---|
| `POLISH_LENIENCY` | `lenient` | `placeholder.ts:35` | Gap-detection aggressiveness: `strict` \| `normal` \| `lenient`. |
| `POLISH_FORCE_ALL_GAPS` | (unset) | `attributes-detect.ts:24` | When `1`, treats every observed attribute as a gap. |
| `POLISH_ATTR_LIMIT` | (unset) | `attributes-detect.ts:90` | Cap on # of attribute gaps processed (test mode). |
| `POLISH_FLOW_LIMIT` | (unset) | `commands/polish.ts:108` | Cap on # of flows/steps processed (test mode). |
| `POLISH_CONFIDENCE` | `0.8` | `confidence.ts:7` | Auto-approval threshold for attribute drafts. |
| `POLISH_CONCURRENCY` | `8` (cap 64) | `concurrency.ts:3` | Max concurrent LLM calls. |
| `AI_TYPE` | `anthropic` | `commands/polish.ts:70` | LLM provider. |
| `AI_MODEL` | model-dependent | `commands/polish.ts:88` | Model id. |
| `AI_API_KEY` | — | `commands/polish.ts:71` | Required for non-`claude-code` providers. |
| `AI_BASE_URL` | `https://api.ollama.com/v1` | `commands/polish.ts:97` | Used only for `openai-compat`. |

---

## 10. Debug artefacts (under `output/.polish/`)

| Path | Producer | Content |
|---|---|---|
| `attributes-detect-debug.json` | detect | Per-observation classification: `{ucId, action, pathKey, isGap, reason, existing}`. |
| `attributes-detected/<uc>__<action>.json` | mine | Full `ContextBundle` dump for each (uc, action). |
| `attributes-mine-timings.log` | mine | TSV `timestamp\taction\tpathKey\telapsedMs\tdone/total`. |
| `attributes-dedup-groups.json` | dedup | Group summary: signature, fingerprint, member count, openapi description, savings %. |
| `llm-prompts/<slug>.txt` | preview-prompts | Exact LLM prompt for each dedup group. |
| `llm-prompts/_index.tsv` | preview-prompts | Index of the above. |
| `attributes-review/<uc>__<action>.json` | review | Pre-approved snapshot + final state for each (uc, action). |

---

## 11. Extending the pipeline

To add a new attribute-phase step:

1. Create `src/polish/steps/attributes-<name>.ts` exporting a `PolishStep` (id, title, async run(ctx)).
2. Read inputs from `ctx.state` (e.g. `attributeBundles`), write outputs back into `ctx.state` with a new well-named key.
3. Persist any debug artefacts to `join(ctx.outputDir, ".polish", "<name>...")`.
4. Append the step to `POLISH_PIPELINE` in `pipeline.ts` at the correct position.
5. If introducing a new LLM call: respect `POLISH_CONCURRENCY` via `runWithConcurrency`; emit `BatchEvent`s for retries/fallbacks; consider whether the output needs confidence scoring.

To add a new mining source:

1. Extend `ContextBundle` (`attributes/types.ts`) with the new field.
2. Populate it inside `buildBundles` (`attributes/mine-context.ts`).
3. Add a corresponding field to `LLMInputAttr` (`attributes/draft.ts`) and reference it in the prompt's EVIDENCE PRECEDENCE list at the right tier.
4. If the new signal should influence dedup grouping, include a derived shape in `computeSignature` or `computeRefFingerprint` (`attributes/dedup.ts`).
5. If it's a confidence signal, add a factor in `scoreAttributeDraft` (`review/confidence.ts`).
