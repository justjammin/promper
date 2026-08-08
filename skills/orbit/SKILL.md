---
name: orbit
description: >
  Full promper-native pipeline orchestrator (successor to forge). Runs one rough intent through
  a disciplined cosmology arc — Genesis (evidence + interview + positioning + domain) → Sideeye
  (pattern SELECT + critique) → Horizon (HTML visual validation) → Execute (breakdown or
  singularity) → Sideeye REVIEW (Standards + Spec). Human gates between phases prevent wasted
  cycles. Every phase is a promper-family skill — no external research/PRD-prep or
  bespoke-HTML-artifact dependencies. Triggers on:
  "/promper:orbit", "orbit this", "run the full pipeline on", "build this end to end".
  Use to go from rough intent to converged, reviewed output without skipping quality gates.
---

# orbit — full pipeline orchestrator

`orbit` runs the promper-native arc from first light to convergence, stopping at a human gate
between phases. Each gate is a checkpoint — exit, adjust, or proceed.

```
Phase 0 — Genesis         evidence + interview + positioning + domain model   (skill: genesis)
Phase 1 — Sideeye SELECT  which patterns? critique the Genesis plan           (skill: sideeye)
Phase 2 — Horizon         HTML visual validation of the plan                  (skill: horizon)
Phase 3 — Execute         compile / converge                                  (breakdown | singularity)
Phase 3b — Sideeye REVIEW Standards + Spec on the produced code               (skill: sideeye)
```

Review + diagnose are **not** a separate skill (see `DESIGN.md` §6): Sideeye REVIEW handles
the two axes; bug fixes happen inside the execution engine via a red-capable tight-loop and
bead tickets — never speculative remediation.

---

## Invocation

```
/promper:orbit <intent>
/promper:orbit migrate billing to event sourcing
/promper:orbit --engine singularity build the analytics export pipeline
/promper:orbit --from horizon <intent>        # resume at a later phase
/promper:orbit --run <intent>                 # proceed through all gates automatically
```

| Flag | Default | Purpose |
|---|---|---|
| `--engine breakdown\|singularity` | `breakdown` | Execution engine for Phase 3. |
| `--tribunal solo\|magi` | `solo` | Sideeye tribunal for Phases 1 & 3b: one skeptic, or the 3-core MAGI vote. |
| `--from <phase>` | `genesis` | Start at `genesis`, `sideeye`, `horizon`, `execute`, `review`. |
| `--run` | false | Auto-advance human gates. Correctness gates still block. |
| `--skip-horizon` | false | Text-only validation; skip the HTML gate. |
| `--no-beads` | false | Passed to the execution engine. |
| `--out <dir>` | `.promper/<slug>/` | Artifact directory. |
| `--observer <url>` | unset | Optional Horizon base URL for state-only tracker updates. |

---

## Before starting

1. Confirm the intent is specific enough. If not, ask one focused batch (2–3 questions) before
   Genesis. Do not expand vagueness into invented requirements.
2. Show the pipeline map with selected phases, flags, chosen engine, and artifact directory.
3. Stop with:
   ```
   ORBIT READY
   Phases: 0 → 1 → 2 → 3 → 3b
   Engine: breakdown
   Artifacts: .promper/<slug>/
   Proceed? [enter to start / adjust intent / --from <phase>]
   ```
   Skip this checkpoint only when `--run` is present.

---

## Phase 0 — Genesis

**Invoke:** `genesis`.
Gathers scoped repo evidence, interviews the user, pins positioning + ubiquitous language +
entities, drafts a scope preview. Emits `genesis.md` + `plan.json` (the spine).

**Gate 0 → 1**
```
GENESIS COMPLETE
Intent / Evidence(N) / Positioning / Open Qs(N, M blocking)
Artifacts: .promper/<slug>/genesis.md, plan.json
Proceed to pattern selection? [enter / fix positioning / add evidence]
```
Unresolved blocking questions are surfaced before "proceed" is offered.

---

## Phase 1 — Sideeye SELECT

**Invoke:** `sideeye` in SELECT mode on `plan.json`.
Selects the patterns the evidence supports; rejects the rest with missing evidence named;
critiques the Genesis plan. Writes `patterns.selected` / `patterns.rejected` back into
`plan.json`; narrative to `sideeye-select.md`.

**Tribunal:** `solo` (default) or `magi` (`--tribunal magi`). Use `magi` when the pattern choice
is contested, blast radius is high, or the change is irreversible: the three MAGI cores
(Melchior/Balthasar/Casper) each judge from their persona lens, write to a shared `PROPOSAL.md`,
and cast a binary APPROVE/DENY vote resolved deadlock-free by majority (see `sideeye/magi/`). The
consensus becomes this gate's verdict; a split lowers confidence one level and the dissent's
rationale is folded into the findings. orbit auto-suggests `magi` when the Genesis plan carries a
P0 risk, the change is irreversible, or SELECT confidence is Low.

**Gate 1 → 2**
```
SIDEEYE SELECT COMPLETE
Selected: [list]  Rejected: [list + reason]  Confidence: [H/M/L]
Proceed to visual validation? [enter / dispute a rejection / adjust]
```
A disputed rejection re-runs SELECT with the new evidence before proceeding. `Request-changes`
loops to Genesis.

---

## Phase 2 — Horizon

**Invoke:** `horizon` (skip if `--skip-horizon`).
Serves `plan.json` through the templated Elysia surface; the user edits fields, answers open
questions, and approves per section. Writes `horizon/feedback.json`; merged edits applied back
into `plan.json`.

Foreground-poll `GET /api/poll` until `{ ready: true }`. Never background the poll without a
verified wake-path; feedback is durable on disk regardless.

**Gate 2 → 3**
```
HORIZON COMPLETE
Verdict: [approved | changes-requested]
Edits: [N] / Answered: [M] / Sections: [approve|change each]
approved -> execution;  changes-requested -> loop to [genesis | sideeye]
```
`changes-requested` loops to Genesis (if positioning/evidence flagged) or Sideeye (if patterns
flagged). No source edits happen until this gate clears.

---

## Phase 3 — Execute

Record the fixed point (commit/HEAD) before any source edit, for the Phase 3b review diff.

**Engine = breakdown** (default): invoke `promper:breakdown --out .promper/<slug>/`. It runs the
delta-interview (`breakdown-interview.md`) — derives the PRD from the validated `plan.json`,
asks only residual gaps — then compiles `PRD.md`, `graph.json`, `plan.md`, `prompts/node-*.md`
and beads (unless `--no-beads`).

**Engine = singularity**: invoke `promper:singularity --prd` derived from `plan.json`, `--run`
(execution approved by the gates above), `--out .promper/<slug>/`. Bounded accretion-collapse
until acceptance criteria pass or event horizon. Suggest `singularity` automatically when
`scope.nodesPreview` > 8 nodes or open questions are marked adaptive.

**Bug handling (both engines):** a live failure becomes a focused remediation node (singularity)
or a new bead ticket (breakdown). Build a **red-capable reproduction** before proposing any fix.
No speculative remediation — a remediation is valid only with a changed action, new evidence, or
a different method.

**Gate 3 → 3b**
```
EXECUTE COMPLETE
Engine: [breakdown | singularity]
Status: [package produced | SINGULARITY REACHED | EVENT HORIZON | STALLED]
Result: .promper/<slug>/RESULT.md
Proceed to review? [enter / inspect result / exit]
```

---

## Phase 3b — Sideeye REVIEW

**Invoke:** `sideeye` in REVIEW mode.
Invoke Sideeye's **code-review branch** explicitly. First resolve the recorded fixed point and
compute the scoped diff. An invalid ref or empty diff must fail before dispatch.

Two independent axes on the diff since the recorded fixed point:
- **Standards** — does the code follow this repo's conventions?
- **Spec** — does it meet the PRD acceptance criteria (derived from `positioning.successCriteria`)?
Writes `sideeye-review.md`.

**Tribunal:** honors `--tribunal`. On `magi`, each axis receives its own three-core vote and
majority tally. Never merge Standards and Spec into one consensus. A `Request changes` /
`Reject approach` consensus loops the fix into the execution engine's tight-loop with a bead
ticket — never a speculative remediation.

**Final output**
```
ORBIT COMPLETE
────────────────────────────────
Standards: [N findings — worst: X]
Spec:      [N findings — worst: Y]
────────────────────────────────
Artifacts: .promper/<slug>/
  genesis.md / plan.json        (Phase 0)
  sideeye-select.md             (Phase 1)
  horizon/feedback.json         (Phase 2)
  PRD.md / graph.json / RESULT.md (Phase 3)
  sideeye-review.md             (Phase 3b)
```
Report the two axes verbatim under `## Standards` and `## Spec`. Live-bug findings loop into the
execution engine's tight-loop, not a separate skill.

---

## Artifact layout

See `DESIGN.md` §5. Add `.promper/` to `.gitignore` on first use.

---

## Optional observer

`--observer <url>` enables the Horizon tracker. This optional observer is non-blocking and never becomes a
pipeline gate. POST the complete current snapshot to `<url>/api/status` at every:

- phase transition, including each active and done state;
- blocked correctness gate;
- MAGI initialization;
- per-core `deciding` and `decided` transition;
- consensus transition; and
- terminal Orbit state.

Payloads must validate against `viz/status.schema.json` and carry state only.
Never include intent, PRD, plan, vote, verdict, rationale, evidence, or decision content. MAGI identity and
`deciding`/`decided` lamps are allowed; `consensusReached` is only a boolean.

If the observer is disabled or a POST fails, continue the run and record one
non-blocking observer warning in the run log. Do not retry in a way that delays a phase or
changes its gate.

---

## Rules

- **Gates are not optional** unless `--run`. Never auto-advance into Phase 3 execution without a
  cleared Horizon gate.
- **`plan.json` is the spine.** Genesis creates it; Sideeye and Horizon enrich it in place;
  the execution engine consumes it. One shape, threaded end to end.
- **No target-repo source edits before Phase 3.** Genesis, Sideeye, and Horizon artifacts live
  under `.promper/` and are never gated against the repo.
- **Scope is fixed at Genesis.** A gap found later is a new orbit run, not inline scope creep.
  A node that needs a Sideeye-rejected pattern is a scope change — stop and raise it.
- **`--run` removes human gates, not correctness gates.** Sideeye `Request-changes` and Horizon
  `changes-requested` still block; auto-loop to the flagged phase, fix, re-run.
- **Diagnose in-engine.** No speculative remediation without a red-capable reproduction loop.
- **Tribunal is deadlock-free.** MAGI = 3 binary votes, majority rule, no abstain — a verdict is
  always reached. `solo` is the default; escalate to `magi` for contested, high-blast-radius, or
  irreversible decisions.
