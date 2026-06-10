# `polish` — Example Commands

Copy-paste recipes for the `polish` command. Dev-mode invocation (`npx tsx src/index.ts`)
is shown — swap for the built binary `ondc-tools polish …` after `npm run build`.

Full reference: [`POLISH.md`](./POLISH.md).

---

## Basics

```bash
# Minimal run — all phases (overview → attributes → flows)
npx tsx src/index.ts polish -i ./input-config -o ./polished-config
```
Resolves the split-config at `-i`, runs the whole pipeline, writes a new split-config to `-o`
(plus debug artefacts under `-o/.polish/`).

```bash
# Show every flag
npx tsx src/index.ts polish --help
```

```bash
# Next step after polishing — flatten to a single build.yaml
npx tsx src/index.ts parse -i ./polished-config -o ./build.yaml
```

---

## Phase selection (`--phase`)

```bash
# Only the attributes phase (skip overview + flows)
npx tsx src/index.ts polish -i ./in -o ./out --phase attributes
```

```bash
# Two phases at once (comma-separated)
npx tsx src/index.ts polish -i ./in -o ./out --phase overview,flows
```
`scaffold`, `context-pdfs-load`, and `reuse-load` are prep steps that always run regardless of `--phase`.

---

## LLM provider / model

```bash
# Anthropic (default provider) with an explicit key + model
npx tsx src/index.ts polish -i ./in -o ./out \
  --provider anthropic --model claude-haiku-4-5-20251001 --api-key sk-ant-...
```

```bash
# Use your existing Claude Code login (no API key needed)
npx tsx src/index.ts polish -i ./in -o ./out --provider claude-code --model claude-haiku-4-5
```

```bash
# Any OpenAI-compatible endpoint (Ollama Cloud, Groq, Together, …)
AI_BASE_URL=https://api.groq.com/openai/v1 \
npx tsx src/index.ts polish -i ./in -o ./out \
  --provider openai-compat --model llama-3.3-70b --api-key gsk_...
```

```bash
# Same thing via env vars instead of flags
AI_TYPE=anthropic AI_MODEL=claude-haiku-4-5-20251001 AI_API_KEY=sk-ant-... \
npx tsx src/index.ts polish -i ./in -o ./out
```

---

## Context PDFs (`--context-pdf`, repeatable)

```bash
# Enrich prompts with domain PDFs (extracted once, cached, retrieval-selected per call)
npx tsx src/index.ts polish -i ./in -o ./out \
  --context-pdf ./specs/FIS10.pdf \
  --context-pdf ./specs/account-aggregator.pdf
```

---

## Skip usecases (`--skip-usecase`, repeatable)

```bash
# Leave specific usecases untouched (not drafted, reviewed, or written)
npx tsx src/index.ts polish -i ./in -o ./out \
  --skip-usecase "GOLD LOAN" --skip-usecase "PERSONAL LOAN"
```

---

## Reuse prior reviewed descriptions (`--reuse-from` / `--reuse-verbatim`)

Reuse **approved** attribute descriptions from earlier polish runs. Matching is by
`(action, pathKey)` and **ignores usecase**, so the same `(action, path)` can match across
multiple external usecases.

```bash
# ENRICH (default): feed matching reviewed descriptions into the draft prompt as
# high-priority evidence; the LLM still writes the final text.
npx tsx src/index.ts polish -i ./in -o ./out --phase attributes \
  --reuse-from ./temp-dir/cleaned-2
```

```bash
# Point at an attributes-review dir directly (instead of the .polish parent)
npx tsx src/index.ts polish -i ./in -o ./out \
  --reuse-from ./temp-dir/cleaned-2/.polish/attributes-review
```

```bash
# Multiple sources — descriptions from all are indexed (repeatable)
npx tsx src/index.ts polish -i ./in -o ./out \
  --reuse-from ./prior/gold-loan-output \
  --reuse-from ./prior/personal-loan-output
```

```bash
# VERBATIM: on a match, SKIP the LLM and adopt the first match's description as-is
# (owner/type/required/usage still derived locally). Fastest, fully reuses prior text.
npx tsx src/index.ts polish -i ./in -o ./out --phase attributes \
  --reuse-from ./temp-dir/cleaned-2 --reuse-verbatim
```

Notes:
- Only `approved: true` entries are indexed; `AUTO-FALLBACK` / `<no-enough-data>` / empty are skipped.
- Enrich injects up to 3 distinct matches per attribute; verbatim takes the first.
- Reused drafts are scored normally in review (no auto-approve).
- Missing `--reuse-from` paths warn and are skipped — they never abort the run.

---

## Environment-variable tuning

These are read from the environment (no CLI flag); combine with any command above.

```bash
# Force a description for EVERY observed attribute (ignore gap heuristics)
POLISH_FORCE_ALL_GAPS=1 npx tsx src/index.ts polish -i ./in -o ./out --phase attributes
```

```bash
# Gap-detection aggressiveness: strict | normal | lenient (default lenient)
POLISH_LENIENCY=strict npx tsx src/index.ts polish -i ./in -o ./out --phase attributes
```

```bash
# Cap attributes / flows processed — fast test runs
POLISH_ATTR_LIMIT=20 POLISH_FLOW_LIMIT=3 \
npx tsx src/index.ts polish -i ./in -o ./out
```

```bash
# Auto-approval threshold (0..1, default 0.8) + LLM concurrency (default 8, cap 64)
POLISH_CONFIDENCE=0.6 POLISH_CONCURRENCY=16 \
npx tsx src/index.ts polish -i ./in -o ./out --phase attributes
```

```bash
# Review/paraphrase web UI port (default 4747)
POLISH_PORT=5000 npx tsx src/index.ts polish -i ./in -o ./out
```

---

## End-to-end: reuse + tune + flatten

```bash
# Attributes-only, reuse a prior domain verbatim, looser threshold, capped for a quick pass
POLISH_CONFIDENCE=0.6 POLISH_ATTR_LIMIT=50 \
npx tsx src/index.ts polish \
  -i ./formatted-configs/ONDC:FIS10/2.1.0/config \
  -o ./polished/FIS10-2.1.0 \
  --phase attributes \
  --reuse-from ./prior/FIS10-2.0.0 --reuse-verbatim \
  --context-pdf ./specs/FIS10.pdf

# Then flatten and validate
npx tsx src/index.ts parse -i ./polished/FIS10-2.1.0 -o ./build.yaml
npx tsx src/index.ts validate -i ./build.yaml
```
