---
name: genesis
description: >
  The origin step of the promper:orbit arc — run before any PRD. Gathers scoped repo evidence,
  interviews the user relentlessly, and pins down positioning and a ubiquitous language, then
  emits both a human brief (genesis.md) and a machine shape (plan.json) that the rest of the
  pipeline threads through. Composes evidence, interview, and domain
  disciplines into one promper-native step. Triggers on: "genesis", "scope this", "gather
  evidence and positioning for", "/promper:genesis <intent>". Use before breakdown when the
  intent is still rough and the ground is not yet understood.
---

# genesis — origin scoping (evidence · interview · positioning · domain)

Genesis is the first light of an `orbit` run. Nothing is built here and no PRD is written.
Genesis produces the **shared evidence base and positioning** that Sideeye critiques, Horizon
validates, and Breakdown/Singularity execute against.

It replaces external research and the ad-hoc PRD interview with one promper-native
step that composes three disciplines:

1. **Evidence** — scoped, primary-source, repo-grounded facts.
2. **Interview** — relentless questioning that turns vague intent into sharp, testable
   requirements and records decisions.
3. **Domain** — ubiquitous language, entities, and positioning.

---

## Request

```
$ARGUMENTS
```

If non-empty, treat it as the rough intent and begin. If empty, infer the intent from the
conversation and confirm it in one line before starting.

---

## Output artifacts

Written to `.promper/<slug>/` (never inside the target repo source):

- `genesis.md` — the human brief (prose + tables).
- `plan.json` — the machine shape (see `../horizon/schemas/plan.schema.json`). This is the
  spine of the whole pipeline: Sideeye and Horizon enrich it in place.
- `adr/*.md` — optional, one per architectural decision recorded during the interview.
- `glossary.md` — optional, the ubiquitous-language terms.

---

## Workflow

### 1. Frame the intent
State the intent in one sentence. If it is too vague to scope, ask **one** focused batch (2–3
questions) before gathering evidence. Do not invent requirements to fill vagueness.

### 2. Gather scoped evidence (research discipline)
Investigate the intent against high-trust sources, scoped to what the intent actually touches:
- Existing patterns in the target repo for this problem space (read-only).
- Known failure modes, constraints, and prior decisions (ADRs, comments, tests).
- First-party docs / specs / APIs for any external surface involved.

Record each fact as an evidence row: `{ id, claim, source, confidence }`. `source` is a repo
path or a primary URL. Never record a claim you cannot point to a source for — mark genuine
unknowns as `openQuestions` instead.

Prefer `ctx_compose` / `ctx_search` / `ctx_callgraph` for repo evidence over ad-hoc reads.

### 3. Interview relentlessly
Grill the intent until the positioning is sharp. Batch questions (2–4 at a time), never one at a
time. Drive toward:
- **Problem** — what is actually broken / missing, and for whom.
- **Audience** — who consumes the result.
- **Success criteria** — testable, observable outcomes (these become the spec later).
- **Non-goals** — what is explicitly out of scope.
- **Blocking unknowns** — anything that must be answered before design; record as
  `openQuestions` with `blocking: true`.

When a decision is made during the interview, record it as an ADR entry (if
doc-recording mode is on) so the reasoning survives the session.

### 4. Model the domain
Extract the ubiquitous language and the entities in play:
- `glossary` — term → definition, one line each. Use the user's words, not invented ones.
- `entities` — name, responsibilities, relations. Only the entities this intent touches.

### 5. Draft the scope preview
Sketch (do not compile) the likely node shape: `scope.nodesPreview[] = { id, title, domain }`.
This is a preview for Sideeye and Horizon to react to — Breakdown compiles the real graph later.

### 6. Emit artifacts
Write `genesis.md` and `plan.json`. `plan.json` must validate against
`../horizon/schemas/plan.schema.json`. Leave `patterns.selected` / `patterns.rejected` empty —
Sideeye fills those in Phase 1.

---

## Gate 0 → 1

```
GENESIS COMPLETE
Intent:      [one line]
Evidence:    [N facts — highest-uncertainty item named]
Positioning: [problem → audience → success criteria count]
Open Qs:     [N, of which M blocking]
Artifacts:   .promper/<slug>/genesis.md, plan.json

Proceed to pattern selection (Sideeye)? [enter / fix positioning / add evidence]
```

If any `openQuestions.blocking == true` remain unanswered, do not present "proceed" as the
default — surface the blockers first and resolve them.

---

## Rules

- **No PRD here.** Genesis scopes; Breakdown compiles. Do not write acceptance criteria beyond
  the `successCriteria` positioning list.
- **No source edits.** Genesis is read-only against the target repo.
- **Evidence needs a source.** A claim with no `source` is an `openQuestion`, not evidence.
- **Positioning is the contract.** `successCriteria` and `nonGoals` set here bound every later
  phase. Widening them later is a new orbit run.
- **`plan.json` is the spine.** Emit it in the exact schema shape so Horizon can render it and
  Breakdown can consume it without translation.
