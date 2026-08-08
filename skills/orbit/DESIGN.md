# promper:orbit — Pipeline Design

`promper:orbit` is the successor to `forge`. It runs one rough intent through a disciplined,
promper-native arc and stops at a human gate between each phase. It replaces external
research/PRD-prep and bespoke-HTML-artifact steps with promper-family skills plus one small
local tool (Horizon).

```
Genesis  →  Sideeye  →  Horizon  →  Execute (Breakdown | Singularity)
 (birth)   (critique)  (validate)   (compile / converge)
```

---

## 1. Naming map (cosmology arc)

| Name | Role | Metaphor |
|---|---|---|
| **Orbit** | The orchestrator — runs the whole arc, holds the gates | the path the work traces around the goal |
| **Genesis** | Evidence + interview + positioning + domain model, before any PRD | the origin / first light |
| **Sideeye** | Skeptical critique + pattern SELECT (design-time) and Standards/Spec review (post-execution) | the observer that doubts |
| **Horizon** | HTML visual-validation gate — renders the plan, captures edits/answers | the event horizon: the last surface you inspect before collapse |
| **Breakdown** | Compile the validated plan into PRD + beads + per-node prompts | — |
| **Singularity** | Bounded accretion-collapse execution loop | collapse to a converged point |

> Naming note (resolved from the edited spec): **Horizon = the Elysia HTML validation gate**
> (formerly proposed as "Aperture"). The earlier standalone "merged review+diagnose skill"
> is dissolved — see §6, *Review & Diagnose contract*. There is no separate review phase skill.

---

## 2. Pipeline overview

| Phase | Name | Skill invoked | Gate |
|---|---|---|---|
| 0 | Genesis | `genesis` (this repo) | Evidence + positioning approved |
| 1 | Sideeye SELECT | `sideeye` (SELECT, tribunal `solo`\|`magi`) | Pattern verdict on the Genesis plan |
| 2 | Horizon | `horizon` (local Elysia tool) | Visual validation — `feedback.json.verdict == approved` |
| 3 | Execute | `promper:breakdown` **or** `promper:singularity` | Package produced / goal converged |
| 3b | Sideeye REVIEW | `sideeye` (REVIEW, tribunal `solo`\|`magi`) | Standards + Spec on produced code |

**Tribunal** (orthogonal to SELECT/REVIEW): `solo` = one skeptic (default). `magi` = the three-core
MoE (Melchior-1 / Balthasar-2 / Casper-3) — each writes a plan to a shared `PROPOSAL.md` and casts
a binary APPROVE/DENY vote resolved deadlock-free by majority (3 binary votes cannot tie). Mapping:
3-0 → Approve, 2-1 → Approve with changes, 1-2 → Request changes, 0-3 → Reject approach. See
`sideeye/magi/` and `sideeye/SKILL.md` §Tribunal. Select with `--tribunal`; orbit auto-suggests
`magi` for P0-risk, irreversible, or Low-confidence decisions.

Phase 3 picks **one** execution engine:

- **Breakdown** — finite, one-shot: compiles the plan into a fixed PRD + node graph + prompts,
  then stops. Use when scope is known and bounded.
- **Singularity** — bounded convergence loop: executes, evaluates evidence, appends focused
  remediation nodes, collapses completed outputs, resumes until acceptance criteria pass or an
  event-horizon limit is hit. Use when the plan needs to adapt as gaps appear.

Selection: `--engine breakdown|singularity` (default `breakdown`; `orbit` suggests `singularity`
when the Genesis scope preview has > 8 nodes or open questions marked `adaptive`).

---

## 3. Phase contracts

Every phase declares **Input → Process → Output → Gate**. Artifacts live outside the target
repo root under `.promper/<slug>/`, so nothing before Phase 3 execution touches source.

### Phase 0 — Genesis
- **Input:** rough intent; target repo (read-only).
- **Process:** scoped repo evidence gathering (evidence discipline), relentless interview
  (interview discipline), positioning + ubiquitous language + entities (domain discipline).
- **Output:** `genesis.md` (human brief) and `plan.json` (machine shape — §5 schema).
  Optional: `adr/*.md`, `glossary.md` if domain decisions are recorded.
- **Gate:** user confirms the evidence table and positioning are right before pattern selection.

### Phase 1 — Sideeye SELECT
- **Input:** `plan.json` (evidence, positioning, scope preview).
- **Process:** `sideeye` SELECT — choose the architecture/data/API patterns the evidence
  supports; reject the rest with the missing evidence named; critique the Genesis plan. Under
  `--tribunal magi` the three MAGI cores judge in parallel and vote; the consensus is the verdict.
- **Output:** writes `patterns.selected` / `patterns.rejected` back into `plan.json`; full
  narrative to `sideeye-select.md`.
- **Gate:** verdict (Approve / Approve-with-changes / Request-changes). Request-changes loops
  to Genesis.

### Phase 2 — Horizon
- **Input:** `plan.json`.
- **Process:** serve the templated HTML surface (Elysia, §7). User reviews the rendered plan,
  edits fields, answers `openQuestions`, approves or requests changes. Agent long-polls.
- **Output:** `horizon/feedback.json` (§5 schema). Merged edits applied back into `plan.json`.
- **Gate:** `feedback.json.verdict == approved`. `changes-requested` loops to Genesis or Sideeye
  depending on which section the user flagged.

### Phase 3 — Execute
- **Input:** validated `plan.json` (+ `feedback.json`).
- **Process:** `promper:breakdown` (delta-interview consumes the validated plan — §breakdown)
  **or** `promper:singularity`. Beads epic + per-node issues created here (unless `--no-beads`).
- **Output:** breakdown → `PRD.md`, `graph.json`, `plan.md` (execution plan), `prompts/node-*.md`;
  singularity → `singularity.json`, `orbits/`, `collapses/`, `RESULT.md`.
- **Gate:** package produced (breakdown) or `SINGULARITY REACHED` (singularity).

### Phase 3b — Sideeye REVIEW
- **Input:** produced code diff since the fixed point recorded at Phase 3 start; `PRD.md`.
- **Process:** invoke Sideeye's code-review branch. Resolve the fixed point and require a
  non-empty scoped diff before reviewer dispatch. Run two independent axes: **Standards**
  (repo conventions, with heuristic smells separate) and **Spec** (PRD acceptance criteria,
  missing requirements, scope creep, and incorrect implementations). Under
  `--tribunal magi`, each axis gets its own three-core vote and majority tally.
- **Output:** `sideeye-review.md`.
- **Gate:** report only. Live-bug findings enter the tight-loop inside the execution engine
  (§6), not a separate remediation skill.

---

## 4. Graph nodes

`orbit` compiles the arc into a small deterministic graph (no LLM routing for the phase edges).

```json
{
  "goal": "<intent>",
  "slug": "<slug>",
  "engine": "breakdown",
  "nodes": [
    { "id": "genesis",       "skill": "genesis",              "gate": "evidence-approved",   "in": [],            "out": ["plan.json", "genesis.md"] },
    { "id": "sideeye-select","skill": "sideeye:select",       "gate": "pattern-verdict",     "in": ["genesis"],   "out": ["plan.json", "sideeye-select.md"] },
    { "id": "horizon",       "skill": "horizon",              "gate": "visual-validation",   "in": ["sideeye-select"], "out": ["feedback.json", "plan.json"] },
    { "id": "execute",       "skill": "promper:breakdown|promper:singularity", "gate": "package-or-converged", "in": ["horizon"], "out": ["PRD.md", "graph.json", "RESULT.md"] },
    { "id": "sideeye-review","skill": "sideeye:review",       "gate": "report",              "in": ["execute"],   "out": ["sideeye-review.md"] }
  ],
  "edges": [
    ["genesis","sideeye-select"],
    ["sideeye-select","horizon"],
    ["horizon","execute"],
    ["execute","sideeye-review"]
  ],
  "loops": [
    { "from": "sideeye-select", "to": "genesis", "when": "verdict == request-changes" },
    { "from": "horizon",        "to": "genesis|sideeye-select", "when": "verdict == changes-requested" }
  ]
}
```

`plan.json` is the spine — it is created by Genesis and enriched in place by Sideeye and Horizon,
then consumed by the execution engine. One artifact, one shape, threaded through every phase.

---

## 5. Artifact layout

```
.promper/<slug>/
  genesis.md              Phase 0 human brief
  plan.json               Phase 0 shape — enriched by Phases 1 & 2
  adr/*.md                Phase 0 (optional, recorded domain decisions)
  glossary.md             Phase 0 (optional)
  sideeye-select.md       Phase 1
  horizon/
    feedback.json         Phase 2 output
    plan.snapshot.json    Phase 2 pre-edit snapshot
  PRD.md                  Phase 3 (breakdown)
  graph.json              Phase 3 (breakdown)
  plan.md                 Phase 3 (breakdown execution plan)
  prompts/node-*.md       Phase 3 (breakdown)
  singularity.json        Phase 3 (singularity)
  orbits/ collapses/      Phase 3 (singularity)
  RESULT.md               Phase 3
  sideeye-review.md       Phase 3b
```

Add `.promper/` to `.gitignore` on first use.

---

## 6. Review & Diagnose contract (no standalone skill)

The originally proposed standalone review+diagnose skill is dissolved. Its responsibilities are
distributed:

- **Review** is `sideeye` REVIEW (Phase 3b): two parallel axes — **Standards** and **Spec** —
  reported side by side.
- **Diagnose + fix** happens *inside the execution engine*, not as a downstream skill:
  - A finding that is a live bug/failure becomes a focused remediation node (singularity) or a
    new bead ticket (breakdown).
  - The tight-loop discipline is mandatory: build a **red-capable reproduction** before
    proposing any fix. No speculative remediation. A remediation node/ticket is valid only if
    it has a changed action, new evidence, or a different method.
- **Personas** are promper-native: the reviewer and diagnostician roles are inherited via
  promper role routing, not hand-written.

---

## 7. Horizon tool (summary — full detail in `horizon/`)

A tiny local Elysia (https://elysiajs.com) server that renders `plan.json` through a fixed
HTML template and captures the user's edits/answers as `feedback.json`.

- **JSON-in:** `GET /api/plan` serves the shape; `POST /api/plan` accepts a drag-dropped
  `plan.json` to re-render any shape.
- **JSON-out:** `POST /api/feedback` writes `feedback.json`; the agent long-polls `GET /api/poll`
  and resumes when `ready: true`.
- **Template:** static `index.html` + `render.js` with section renderers keyed by the
  top-level `plan.json` keys. Portable — the exported HTML renders without the server.

See `../horizon/SKILL.md`, `../horizon/schemas/`, `../horizon/server/horizon-server.mjs`,
`../horizon/template/`.

### Optional tracker observer

Orbit may POST state snapshots to the Horizon server's `/api/status` endpoint. Emission occurs
at every phase transition, blocked gate, MAGI initialization, per-core state change, consensus,
and terminal state. The observer is non-blocking: an unavailable endpoint records a warning but
does not alter pipeline control flow.

The status schema is a privacy boundary. It permits phase and MAGI lamp state only; intent,
plans, votes, verdicts, rationales, evidence, and other decision content are forbidden.

---

## 8. Flags (orbit)

| Flag | Default | Purpose |
|---|---|---|
| `--engine breakdown\|singularity` | `breakdown` | Execution engine for Phase 3. |
| `--tribunal solo\|magi` | `solo` | Sideeye tribunal for Phases 1 & 3b. |
| `--from <phase>` | `genesis` | Resume at `genesis`, `sideeye`, `horizon`, `execute`, `review`. |
| `--run` | false | Auto-advance through human gates (correctness gates still block). |
| `--skip-horizon` | false | Text-only validation; skip the HTML gate. |
| `--no-beads` | false | Passed to the execution engine. |
| `--out <dir>` | `.promper/<slug>/` | Artifact directory. |

---

## 9. Rules

- Gates are not optional unless `--run`. Never auto-advance into Phase 3 execution without a
  cleared Horizon gate.
- Sideeye SELECT `Request-changes` blocks Phase 2 — loop to Genesis.
- Horizon `changes-requested` blocks Phase 3 — loop back to the flagged section.
- No target-repo source edits before Phase 3. Genesis, Sideeye, and Horizon artifacts live
  under `.promper/` and are never gated against the repo.
- Scope is fixed at Genesis. A gap found later is a new orbit run, not inline scope creep.
- The breakdown interview must run standalone (§`breakdown-interview.md`) — orbit is optional.
