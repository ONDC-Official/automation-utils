# Attribute Mining — Plain English Guide

A standalone walkthrough of what "mining" does in the `polish` command. No prior reading required.

---

## What is mining?

When `polish` needs to write documentation for an attribute like `message.order.fulfillments.id`, it can't just guess. It first gathers every clue it can find about that attribute: what the official spec says, where it shows up in code, whether anyone saves its value for later, where its value originally came from, and so on. Then it hands that pile of clues to an LLM and says "write a description."

**Mining is the clue-gathering step.** Think of it as a detective compiling a dossier before writing the case report — the report (LLM draft) is only as good as the dossier.

- **Input** — one observed attribute: `(usecase, action, path)`. Example: `(retail-order, on_confirm, message.order.fulfillments.id)`.
- **Output** — a `ContextBundle`: a single object holding every clue we found about that attribute.

---

## Where mining fits

```
walker  →  detect  →  MINE  →  dedup  →  draft (LLM)  →  review  →  write YAML
            │           │        │            │
            │           │        │            └── one LLM call per group of
            │           │        │                attributes that look alike
            │           │        │
            │           │        └── this doc is about THIS step
            │           │
            │           └── "is this attribute already well-documented?"
            │               if no → it's a gap; mine it.
            │
            └── walks every flow payload, finds every attribute that exists
```

`detect` decides *which* attributes need fresh documentation. `mine` then gathers evidence *about* each of those attributes. Mining itself does not call the LLM — it just prepares.

---

## The five evidence sources

Mining looks in five places. Each one captures a different angle on what the attribute "means" in practice.

### 1. The OpenAPI spec

**Code**: `attributes/openapi-lookup.ts`

The OpenAPI spec is the closest thing to a source of truth. Mining walks the spec for the action (`paths["/on_confirm"].requestBody.schema`), follows the path segment-by-segment, resolves `$ref` indirections and `allOf`/`oneOf`/`anyOf` combinators, and returns whatever the spec says about that property: its `description`, the custom `_description` extension (richer ONDC-specific text), its declared type, and any enum values.

**Why it matters**: if the spec already has a description, it's the most authoritative clue we have. The LLM is told to treat it as tier-1 evidence — higher than anything else.

### 2. Code references

**Code**: `attributes/code-analyzer.ts` (the heavy lifting) + `attributes/reference-scanner.ts` (matching)

Every flow step has `mock.generate`, `mock.validate`, and `mock.requirements` — chunks of JavaScript (base64-encoded) that show how the attribute is actually used. Mining base64-decodes each one, parses it with Babel, and walks the AST to find every place the attribute path appears.

For each hit, mining records:

- **Kind** — was it found in `generate` (where the payload is built), `validate` (where assertions about it are made), `requirements` (where prerequisites are stated), or a `comment` (JSDoc)?
- **Role** — `read`, `write`, or `delete`.
- **Gated by** — if the access is inside an `if (...)`, mining captures the condition text. This is hugely informative: "this field is only written when `descriptor.code === 'TERM'`" is a real semantic clue.
- **Snippet** — a short window of code around the access for human inspection.

The matching is fuzzy on purpose. It handles destructuring (`const { id } = fulfillment`), optional chaining (`fulfillment?.id`), bracket access (`fulfillment["id"]`), case variants, and so on — because real code uses all of these.

Capped at 8 hits per attribute to keep prompts manageable.

**Why it matters**: code is ground truth for *behaviour*. The spec might say what a field is; the code shows when it's set, when it's checked, and under what conditions.

### 3. SaveData

**Code**: `attributes/reference-scanner.ts` (`scanSaveData`)

Each step can declare `mock.saveData`: a map of session keys → JSON paths it wants to stash. For example, an `on_init` step might say "save the `bpp_uri` from the response under session key `BPP_URI`."

Mining scans every step's `saveData` and asks: does our attribute (or one of its ancestors) get persisted? Two cases:

- **Direct hit** — the attribute itself is the saveData target. ("This value gets remembered for later.")
- **Inherited hit** — an ancestor was saved; our attribute came along for the ride. We record the ancestor jsonpath so the LLM knows the attribute is anchored inside a saved object.

**Why it matters**: persistence is meaningful. If something is saved, later steps probably consume it — it's likely an identifier, a token, or a piece of state.

### 4. Session reads

**Code**: also in `attributes/mine-context.ts` (uses a "session producer map" built per action)

The flip side of saveData. Before mining starts on an action, it builds a map: "every session key → which step wrote it, what jsonpath it came from."

Then when code references our attribute, mining checks: did the surrounding code also read from a session key? If so, it records where that session key was originally written — the `origin_action`, `origin_path`, `origin_flow`. The result: "this attribute's value typically comes from `transaction_id` saved by `search`."

**Why it matters**: provenance. Knowing where a value came from is half of knowing what it means.

### 5. Cross-flow signals

**Code**: assembled in `attributes/mine-context.ts`, surfaced as `CrossFlowSignals`

Some patterns only show up when you look at the attribute across the whole flow:

- **Round-trip** — is the attribute *set* in a generate step AND *asserted* in the matching validate step? Classic BAP-mints-then-BPP-echoes shape, or vice versa.
- **Required by requirements** — does any `requirements` block check that this attribute is present?
- **Persisted and consumed across steps** — is the attribute saved to the session in one step AND then read back in a different step?

These are flags, not rich data. They give the LLM hints like "name this as a round-trip identifier" or "mention that this anchors the session."

**Why it matters**: high-level shape. A field that round-trips between BAP and BPP is doing a fundamentally different job than one that's only ever set once.

---

## Worked example

Let's mine the attribute:

- **Usecase**: `retail-order`
- **Action**: `on_confirm`
- **Path**: `message.order.fulfillments.id`

### What mining finds

**OpenAPI** — Walks `paths["/on_confirm"].requestBody.schema.properties.message.properties.order.properties.fulfillments.items.properties.id`. The ONDC spec has:

```
description: "Unique identifier for the fulfillment"
type: "string"
```

→ One tier-1 clue.

**Code references** — Scans the JS for every step in every flow involving `on_confirm`.

In `confirm`'s `generate` (BAP-side), found:

```js
order.fulfillments.forEach((f) => {
  if (!f.id) f.id = generateUuid();
});
```

→ Hit: kind=`generate`, role=`write`, gated_by=`!f.id`, snippet shown above.

In `on_confirm`'s `validate` (BPP-side response check), found:

```js
const sentIds = sessionData.FULFILLMENT_IDS;
order.fulfillments.forEach((f) => {
  assert(sentIds.includes(f.id), "fulfillment.id must match the one sent in confirm");
});
```

→ Hit: kind=`validate`, role=`read`. Also a session read of `FULFILLMENT_IDS`.

**SaveData** — `confirm`'s saveData includes:

```js
saveData: { FULFILLMENT_IDS: "$.message.order.fulfillments[*].id" }
```

→ Hit: key=`FULFILLMENT_IDS`, jsonpath=`$.message.order.fulfillments[*].id`. Direct, not inherited.

**Session reads** — In the `validate` snippet above, `sessionData.FULFILLMENT_IDS` is read. The session-producer map says `FULFILLMENT_IDS` was written by `confirm` from path `message.order.fulfillments[*].id`. So:

→ Session read: session_key=`FULFILLMENT_IDS`, origin_action=`confirm`, origin_path=`message.order.fulfillments[*].id`.

**Cross-flow signals** — Tallying everything up:

- `setInGenerate`: ✅ (BAP mints in `confirm`)
- `assertedInValidate`: ✅ (BPP echo is checked in `on_confirm`)
- `persistedKey`: `FULFILLMENT_IDS`
- `consumedAcrossSteps`: ✅

### The resulting bundle (simplified)

```json
{
  "obs": {
    "ucId": "retail-order",
    "action": "on_confirm",
    "pathKey": "message.order.fulfillments.id",
    "valueType": "string",
    "sampleValues": ["F1", "fulfillment-001"],
    "isLeaf": true,
    "seenInFlows": ["flow-happy-path", "flow-partial"]
  },
  "openapi": {
    "description": "Unique identifier for the fulfillment",
    "type": "string"
  },
  "refs": [
    { "flowId": "flow-happy-path", "actionId": "confirm",
      "kind": "generate", "role": "write", "gatedBy": "!f.id",
      "snippet": "if (!f.id) f.id = generateUuid();" },
    { "flowId": "flow-happy-path", "actionId": "on_confirm",
      "kind": "validate", "role": "read",
      "snippet": "assert(sentIds.includes(f.id), ...)" }
  ],
  "saveData": [
    { "flowId": "flow-happy-path", "actionId": "confirm",
      "key": "FULFILLMENT_IDS",
      "jsonpath": "$.message.order.fulfillments[*].id" }
  ],
  "sessionReads": [
    { "sessionKey": "FULFILLMENT_IDS",
      "originAction": "confirm",
      "originPath": "message.order.fulfillments[*].id" }
  ],
  "crossFlow": {
    "setInGenerate": true,
    "assertedInValidate": true,
    "persistedKey": "FULFILLMENT_IDS",
    "consumedAcrossSteps": true
  }
}
```

### What the LLM might write from this

Handed that bundle, the LLM has enough to produce something like:

> Stable identifier for a fulfillment leg of the order. The BAP mints it during `confirm` (defaulting to a UUID when none is provided), saves it to the session, and the BPP echoes the same id back in `on_confirm` so the BAP can match its sent fulfillments against the acknowledged ones.

That sentence is anchored in the evidence: spec text ("identifier for the fulfillment"), code behaviour (`!f.id` gate, validate-side assertion), persistence (saveData), and the round-trip pattern (cross-flow).

---

## What gets dumped to disk

Every mined bundle is written to disk under `output/.polish/`:

- `attributes-detected/<usecase>__<action>.json` — every `ContextBundle` for that `(usecase, action)`. When the LLM produces a weird description, this is where you look to see what evidence it actually had.
- `attributes-mine-timings.log` — TSV log of how long each attribute took to mine. Useful when the mining step feels slow.

---

## What mining is NOT

A few clarifications, because adjacent steps do related-sounding things:

- **Mining doesn't call the LLM.** That's the next-next step (`draft`). Mining only prepares.
- **Mining doesn't judge quality.** Confidence scoring happens in `review`, after a draft exists.
- **Mining doesn't deduplicate.** If two attributes have identical evidence, mining still produces two separate bundles. The `dedup` step ("deduplication") collapses them so the LLM is called once per equivalence class.
- **Mining doesn't decide what's missing.** That's `detect`. Mining only runs on attributes that detect already flagged as gaps.

---

## Where to look in code

| To understand… | Open… |
|---|---|
| The orchestrating loop | `attributes/mine-context.ts` (`buildBundles`) |
| Spec lookup | `attributes/openapi-lookup.ts` |
| JS AST analysis | `attributes/code-analyzer.ts` |
| Fuzzy path matching | `attributes/reference-scanner.ts` |
| The data shapes | `attributes/types.ts` (`ContextBundle`, `LeafObservation`, `ReferenceHit`, `SaveDataHit`, `SessionReadHit`, `CrossFlowSignals`) |
| Which attributes get mined | `steps/attributes-detect.ts` (runs first) |
| Where bundles go next | `steps/attributes-dedup.ts` and `steps/attributes-draft.ts` |
