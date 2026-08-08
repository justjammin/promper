# breakdown — delta-interview (pipeline-agnostic)

`promper:breakdown` keeps its name and its job: compile an intent into a PRD + deterministic
domain graph + beads + per-node prompts. This document specifies **how its requirements
interview behaves**, in a way that works whether or not `orbit`/Genesis ran first.

The design goal: **never re-ask what is already known.** Breakdown detects any upstream plan
artifacts and runs in `delta` mode; with no artifacts it runs the full interview as today.

---

## Mode detection

At start, breakdown looks for upstream artifacts in `--out` (default `.promper/<slug>/`):

| Found | Mode | Behavior |
|---|---|---|
| `plan.json` + `horizon/feedback.json` | `delta` (validated) | Trust the validated plan; ask only what it does not answer. |
| `plan.json` only | `delta` (unvalidated) | Use the plan; confirm positioning once, then ask gaps. |
| neither | `full` | Run the complete requirements interview (current behavior). |

`--prd <path>` still short-circuits the interview entirely (explicit PRD wins over all modes).

This keeps breakdown standalone: run it on its own and you get the full interview; run it after
Genesis+Horizon and it only fills the delta.

---

## What the validated plan already provides

When `plan.json` (+ `feedback.json`) is present, these PRD sections are **derived, not asked**:

| PRD section | Source in plan.json |
|---|---|
| Problem / motivation | `positioning.problem` |
| Audience / users | `positioning.audience` |
| Acceptance criteria (spec) | `positioning.successCriteria` + answered `openQuestions` |
| Constraints & non-goals | `positioning.nonGoals` + `patterns.rejected` (rejected = non-goal) |
| Required patterns | `patterns.selected` (selected = requirement) |
| Domain terms | `domainModel.glossary` |
| Entities / boundaries | `domainModel.entities` |
| Risks | `risks[]` |
| Node seeds | `scope.nodesPreview[]` |

Horizon edits override the original plan values: apply `feedback.json.decisions[].edit` /
`.answer` before deriving the sections above.

---

## The delta interview

Ask only for what remains genuinely undetermined after deriving from the plan. Batch questions
(2–4 at a time); stop as soon as the graph can be compiled. Typical residual gaps:

1. **Unanswered blocking questions** — any `openQuestions` where `blocking == true` and no
   matching `feedback.decisions[].answer`. These must be resolved before compiling. (In `full`
   mode there is no plan, so this maps to normal requirement elicitation.)
2. **Acceptance thresholds** — success criteria that are directional but not measurable
   ("fast" → "p95 < 200ms"). Ask for the number only if a node's done-state depends on it.
3. **Sequencing / lane constraints** — hard ordering or shared-resource constraints not implied
   by `domainModel.entities` relations.
4. **Tooling / environment** — required services, credentials, fixtures a node will need that
   are not evident from the repo.

Do **not** re-ask problem, audience, non-goals, or pattern choices when the plan already carries
them and the user approved them in Horizon.

---

## Contract with the pattern selection

- `patterns.selected` → PRD §Requirements: each selected pattern is a requirement the graph must
  honor.
- `patterns.rejected` → PRD §Non-Goals: each rejected pattern is a non-goal; no node may
  reintroduce it. If a node genuinely needs a rejected pattern, that is a scope change → stop and
  raise it, do not silently add it.

This preserves the Sideeye discipline downstream: breakdown cannot manufacture DAG depth or
smuggle in a queue/CQRS/event-sourcing pattern the evidence rejected.

---

## Output (unchanged)

`PRD.md`, `graph.json`, `plan.md` (execution plan), `prompts/node-*.md`, and beads epic +
per-node issues (unless `--no-beads`). In `delta` mode the PRD header records
`derived-from: plan.json@<hash>` for traceability back to Genesis/Horizon.

---

## Standalone example (no orbit)

```
/promper:breakdown add rate limiting to the public API
# no plan.json present -> full interview -> PRD -> graph -> prompts
```

## Orbit example (delta)

```
# orbit already produced .promper/rate-limit/plan.json + horizon/feedback.json
/promper:breakdown --out .promper/rate-limit/
# delta mode -> derives PRD from validated plan -> asks only residual thresholds -> compiles
```
