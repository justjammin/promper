---
name: breakdown
description: >
  One-shot prompt text expander for prompt engineering. Takes a rough intent and expands it
  into a complete execution package: a tailored PRD (batched requirements interview), a
  deterministic domain breakdown (promper classify over the trigger tables — no LLM routing),
  beads (bd) epic + per-node issues with dependencies, tool + role assignment per node (lean
  map personas via promper hydrate, lean-ctx prescriptions, plugin toolkits), and one
  engineered Claude-XML prompt per node plus a parallel-lane execution plan. Presents
  everything first — zero spawns unless --run. Works on Claude Code and Codex alike (pure
  prose + portable CLI, no hook dependence). Triggers on: "break this down", "PRD this",
  "expand this into a plan", "one-shot expand", "turn this into a project plan".
  Use when the user wants a full plan-and-prompts package, not a single prompt (/promper) or
  a direct answer.
---
​
# breakdown — One-Shot Prompt Expander (PRD · domains · beads · prompts)
​
Expands one rough intent into everything needed to execute it well: **PRD → deterministic
domain graph → beads issues → roles + tools per node → one engineered prompt per node → lane
plan**. Where `/promper` engineers one prompt, `/promper:breakdown` engineers the whole run.
​
**Read first:** `reference/pe-principles.md` in this plugin (the 11 principles, the Claude-XML
skeleton, the Role-Inheritance Contract). Every prompt this skill emits is crafted against it —
cite it, never duplicate it.
​
> **Deterministic where it can be, model-driven where it must be.** Domain routing runs through
> `promper classify` (the same trigger tables promper's scanner uses — zero LLM). Requirements
> gathering, prompt crafting, and judgment calls stay in the model. Same PRD in → same domain
> breakdown out.
​
> **Portable by construction.** No hooks are assumed anywhere: on Claude Code the contract gate
> and spawn enrichment kick in automatically; on Codex (skills-only manifest) every phase has a
> stated degradation. Skill prose + `promper` CLI + optional `bd` — nothing else.
​
---
​
## Invocation
​
```
/promper:breakdown <rough intent>
```
​
**Flags:**
- `--run` — after presenting the full package, execute it: per node, run inline or spawn the
  selected agent (same heuristics as promper Step 7.5). Default is portable: present
  everything, spawn nothing.
- `--no-beads` — skip bd issue creation even when `bd` is on PATH.
- `--prd <path>` — skip the interview; ingest an existing PRD/spec file and normalize it into
  the template below (fill gaps with `[OPEN — ask]` markers instead of inventing answers).
- `--target=portable` (default) — Claude-XML prompts, persona inlined into `<role>`.
- `--target=costar` — CO-STAR skeleton prompts (non-Claude / human use).
- `--out <dir>` — override the artifact directory (default: `<repo-root>/.promper/<slug>/`).
​
---
​
## Flow
​
### Phase 1 — Requirements interview → PRD
​
Choose the interview mode before asking anything. Explicit `--prd <path>` wins and skips the
interview. Otherwise inspect the resolved `--out` directory (default `.promper/<slug>/`):

| Artifacts | Mode | Behavior |
|---|---|---|
| `plan.json` + approved, schema-valid `horizon/feedback.json` with matching slug | `delta` (validated) | Apply Horizon edits and answers, derive known PRD sections, ask only residual gaps. |
| `plan.json` only, or feedback that has not cleared the Horizon gate | `delta` (unvalidated) | Derive known sections, confirm positioning once, then ask residual gaps. |
| Neither | `full` | Run the complete requirements interview. |

In delta interview mode, derive rather than re-ask:

| PRD content | Source |
|---|---|
| Goal, users, acceptance criteria, non-goals | `positioning.problem`, `.audience`, `.successCriteria`, `.nonGoals` |
| Required and rejected patterns | `patterns.selected`, `patterns.rejected` |
| Domain language and boundaries | `domainModel.glossary`, `domainModel.entities` |
| Risks and node seeds | `risks`, `scope.nodesPreview` |
| Answers and edited values | matching `horizon/feedback.json.decisions[]` entries, applied before derivation |

`patterns.selected` become requirements. `patterns.rejected` become non-goals; a node that
needs one is a scope change and must stop for review. Ask only about unresolved blocking
questions, measurable thresholds required for done-state, hard sequencing/resource constraints,
and missing execution environment or credential facts. Batch 2–4 residual questions and stop
as soon as the graph can compile. In validated mode, record
`derived-from: plan.json@<hash>` in the PRD header.

In full mode, do not expand an underspecified intent. Interview like promper Step 3: **2–3
targeted clarifiers per batch, max 2 batches** — batched, never a drip-feed. Ask only what
changes the plan (scope boundaries, acceptance, constraints, audience). Obvious defaults are
taken, not asked; note them in the PRD as assumptions.
​
Then write `PRD.md` with exactly these sections (tailored to prompt-engineering work — each
section feeds a later phase):
​
1. **Goal** — one paragraph, the *why* (Principle 7: give the why).
2. **Context & Inputs** — systems, repos, source material. Long reference material is listed
   here so downstream prompts can order it context-first (Principle 9: long-context ordering).
3. **Users / Audience** — who consumes the outputs.
4. **Deliverables & Output Formats** — exact shape per deliverable (Principle 6: explicit
   output format). Each deliverable becomes one or more nodes in Phase 2.
5. **Acceptance Criteria** — testable, numbered (Principle 11: treat prompts as testable).
   Each criterion maps to a node's `acceptance` field.
6. **Constraints & Non-Goals** — bounds, must/must-nots, out-of-scope (Principle 8).
7. **Tool & Agent Inventory** — live probes, recorded honestly: lean map present?
   (`~/.invoker/map/index.json` — list its domains), `bd` on PATH?, lean-ctx (`ctx_*` tools)
   in session?, relevant plugin toolkits (`~/.invoker/map/toolkits.json`, matching keys only —
   never read the file whole).
8. **Risks & Open Questions** — anything the interview left open, marked `[OPEN — ask]`.
9. **Domain Signals** — per anticipated domain, the trigger keywords the intent implies
   (e.g. backend → "api", "endpoint design"; testing → "test", "qa"). Written BEFORE Phase 2
   and used to phrase node actions, so the deterministic classifier has real signal to bite
   on. Keep the wording of node actions aligned with these signals.
​
`--prd <path>`: read the given file, map its content into the sections above, list every gap
under §8 instead of interviewing.
​
### Phase 2 — Deterministic domain breakdown
​
Draft nodes from PRD §4/§5: one node per deliverable or coherent unit of work, actions phrased
using §9's domain signals. **Most intents are 1–3 nodes; never manufacture a DAG.** A
single-deliverable intent is a single node and skips straight to Phase 4.
​
Per node, run the deterministic classifier:
​
```
promper classify "<node action>" --json
```
​
(`npx @ninjamin/promper classify` when the CLI isn't installed; `node <repo>/bin/promper.mjs
classify` in a dev checkout.) Take `primary` as the node's domain and `matches[0].suggestedAgents`
as the routing shortlist. `"unmapped": true` → rephrase the action once using §9 signals and
re-run; still unmapped → mark the node's domain from your own judgment and record it in
`graph.json.coverage_gaps` (the classifier's verdict is never silently overridden — the gap is
the record).
​
**CLI unavailable** (no node, no checkout): fall back to the manual walk — read
`~/.invoker/map/index.json` domain names, pick per node, note in the plan that routing was
manual, not deterministic.
​
Node contract (superset of promper's shared shape, one object per node in `graph.json`):
​
```json
{ "id": "n1", "domain": "backend", "action": "<verb phrase>", "deps": [],
  "parallel": true, "agent": "<from Phase 4>", "tools": ["<from Phase 4>"],
  "execution": "inline|subagent", "acceptance": ["<PRD §5 refs>"],
  "test_tier": { "write_first": ["integration"], "gated_followup": [], "post_ship": ["smoke", "regression"] },
  "prompt_file": "prompts/node-n1.md" }
```

`test_tier` is populated in Phase 4b (engineering nodes) or set to `null` (everything else).
​
`deps` come from real data/order dependencies only. Nodes in different domains with no shared
inputs are `parallel: true` — this is what spaces tasks across domains into lanes.
​
### Phase 3 — Beads issues (opt-in)
​
Runs when `bd` is on PATH and `--no-beads` is absent. **Every bd failure is non-blocking** —
log it in the plan and continue.
​
```
bd create "Task: <PRD title>" --type epic --json               → epic_id
bd create "Step <id>: <action>" --parent <epic_id> --deps <dep ticket ids> --json   (per node, deps order; omit --deps when empty)
```

**Post-ship test follow-up (one bead per run).** When the graph has at least one engineering
node (domain in the Phase 4b set), create one project-level bead for the `post_ship` smoke and
regression tests. It depends on every engineering node and stays open until the feature ships,
keeping post-merge coverage outside the red-green loop while still tracking it:

```
bd create "Follow-up: smoke + regression for <PRD title>" --parent <epic_id> --deps <all engineering node ticket ids> --json   → followup_tests_id
```
​
Each issue description carries a structured block (portable — plain text, no bd label/priority
flag dependence):
​
```
domain: <node.domain>
agent: <node.agent>
parallel: <true|false>
lane: <lane number>
priority: <P1 = on the critical path (max dep depth), P2 = leaf/parallel>
acceptance:
  - <criterion from PRD §5>
prompt: .promper/<slug>/prompts/node-<id>.md
```
​
Record the mapping in `graph.json`:
​
```json
"beads": { "epic": "<id>", "nodes": { "n1": "<id>", "n2": "<id>" }, "followup_tests": "<id|null>" },
"coverage_gaps": []
```
​
On `--run`, execution drives the lifecycle: `bd update <id> --claim` at node start,
`bd close <id> --reason "Completed by <agent>"` on completion, prune the batch when the run
ends.
​
### Phase 4 — Tool + role assignment per node
​
**Role** — promper Step 4b tier rules, first hit wins: in-session agent list → lean map piece
(`~/.invoker/map/<domain>.json`, walked by description — never read whole) → generic role +
entry in `coverage_gaps`. Persona per promper Step 5; for spawn-ready briefs use the mechanical
shortcut:
​
```
promper hydrate <agent> "<node action>" --json
```
​
Never invent a persona (Role-Inheritance Contract).
​
**Tools** — three layers, all *suggestions in the prompt's `<context>`, never requirements*:
- Plugin toolkits: `~/.invoker/map/toolkits.json[<agent's plugin>]` — matching skills/commands
  only.
- **graphify pre-pass** (when `graphify-out/graph.json` exists in repo root AND `mcp__graphify__*` tools are in session): query graphify FIRST for architecture/graph/explore nodes — answers structural questions from the pre-built graph in seconds; lean-ctx handles file-level details after.
​
| Node type | Graphify tool | Purpose |
|---|---|---|
| explore / architecture | `mcp__graphify__god_nodes` | hub nodes, architectural skeleton |
| explore / architecture | `mcp__graphify__query_graph` | broad context (BFS); add `--dfs` to trace a path |
| graph / deps / impact | `mcp__graphify__shortest_path` | dependency or call path between two concepts |
| community / clusters | `mcp__graphify__get_community` | module shape, cross-cutting concerns |
| node detail | `mcp__graphify__get_node` + `mcp__graphify__get_neighbors` | single concept + connections |
| PR impact | `mcp__graphify__get_pr_impact` | blast radius of a change |
​
No `graphify-out/graph.json` → skip this layer entirely; do not run graphify as a side-effect.
​
- lean-ctx prescriptions by node type (when `ctx_*` tools are in session) — run AFTER graphify pre-pass resolves architectural shape:
​
| Node type | Prescribe |
|---|---|
| explore / research | `ctx_compose` first, `ctx_search` / `ctx_semantic_search` |
| edit / implement | `ctx_read(mode=anchored)` → `ctx_patch`; native Read→Edit fallback |
| verify / test | `ctx_shell` (compressed output) |
| document / summarize | `ctx_read(mode=signatures\|map)` for API surface |
​
No lean-ctx in session → omit the lean-ctx table; the prompts must stand without it.

### Phase 4b — TDD tier assignment (engineering nodes)

Engineering work is authored test-first. Set each node's `test_tier` here. **Engineering domains**
(from the classifier's `ROLE_DOMAIN` buckets): `backend`, `database`, `data`, `ml`, `devops`, `architecture`.
Any node outside this set gets `test_tier: null` and no TDD injection. The `testing` domain is
excluded because it represents tests, not code under test.

The tier is hybrid: the node's domain sets a deterministic base, then risk signals from
`node.action` and PRD sections 5–6 escalate it. Only `write_first` tests belong to the
red-green-refactor loop. `gated_followup` runs against the built node as acceptance gates;
`post_ship` belongs to the project-level bead from Phase 3.

| Trigger | Add to `write_first` | `gated_followup` | `post_ship` |
|---|---|---|---|
| domain in engineering set (base) | `integration` | — | `smoke`, `regression` |
| pure or complex logic (parse, compute, calculate, transform, encode, decode, validate rules, algorithm) | `unit` | — | — |
| user-observable flow (user-facing deliverable, UI/public endpoint, flow, journey, endpoint response) | `system`, `e2e` | — | — |
| `database` or `data`, or action signals schema/query/migration/index | `security` | `perf`, `load`, `stress` | — |
| security-sensitive (auth, login, token, session, payment, Stripe, PII, personal data, upload, external input) | `security` | — | — |

De-duplicate every list. Unit tests are conditional: integration-first coverage suits wiring
nodes, while unit tests are reserved for logic worth driving independently.

No engineering nodes means every `test_tier` is `null`, Phase 3 skips the follow-up bead, and
Phase 5 injects no TDD block.
​
### Phase 5 — One-shot prompts + execution plan
​
Per node, craft one prompt against the Claude-XML skeleton
(`<role><context><instructions><examples><constraints><output_format><thinking>`), all 11
principles applied; `--target=costar` swaps the skeleton. Specifics:
​
- `<role>` — the inherited persona, inlined (portable).
- `<context>` — PRD extracts relevant to this node, ordered long-context-first; tool
  suggestions from Phase 4. A node with deps declares its inputs as
  `[OUTPUT OF PROMPT <dep id>]` slots (Principle 10: chain, don't cram).
- `<constraints>` — PRD §6 plus the node's acceptance criteria restated as testable checks.
- **TDD block (engineering nodes, `test_tier != null`)** — open `<instructions>` with the
  red-green-refactor loop: author the listed `write_first` tests, run them red, implement to
  green, then refactor. Restate each `write_first` test in `<constraints>` as an acceptance
  gate tied to PRD §5. Name `gated_followup` and `post_ship` tests as deferred post-build or
  post-merge checks, not node blockers. Nodes with `test_tier: null` get no TDD block.
- Draft examples are marked `[DRAFT — replace]` exactly as promper does.
​
Write each to `prompts/node-<id>.md`, then `plan.md`:
​
- Lane diagram: nodes grouped into parallel lanes by domain + deps (lane = maximal set of
  mutually-parallel nodes; deps order the lanes).
- Execution table, one row per node:
  `node → lane → domain → agent → inline|subagent (reason) → test tier → bead → prompt file`.
  The **test tier** column lists the node's `write_first` tests, or `—` for `null`.
  Inline-vs-subagent uses promper Step 7.5 heuristics (light <~5K tok noise → inline; noisy /
  parallel siblings / isolation → subagent).
- The bead mapping, including `followup_tests`, and any `coverage_gaps`.
​
**Present the package** (PRD summary, lane diagram, execution table, prompts). **Zero spawns.**
​
**`--run`** (or explicit go afterwards): execute per the table — inline nodes in the main
context; subagent nodes spawned with their hydrated brief, parallel lanes concurrently, deps
order respected. Drive the bead lifecycle (Phase 3). On Codex or any environment without an
Agent/Task tool: run nodes sequentially inline in deps order, or stop at the presented package
— the prompts are the deliverable.
​
---
​
## Artifacts
​
Everything lands in `<repo-root>/.promper/<slug>/` (slug = short kebab title of the intent;
outside a git repo use `./.promper/<slug>/`; `--out` overrides):
​
```
.promper/<slug>/
  PRD.md              # Phase 1
  graph.json          # nodes + beads mapping + coverage_gaps
  plan.md             # lane diagram + execution table
  prompts/node-<id>.md
```
​
Suggest adding `.promper/` to `.gitignore` on first use — committing the package is the user's
call, not the skill's.
​
**Decision hand-off (Claude Code only):** the artifacts live inside the repo, so promper's
contract gate applies to them. Before the first artifact write, record the routing decision at
the decision path given in the injected orchestration contract (session-scoped) — verdict
`"mixed"`, reason `"breakdown plan: <slug>"`, `agent` set only when the graph routes to a
single agent. No injected contract (Codex, hooks off) → skip; there is no gate to satisfy.
​
---
​
## Edge cases
​
- **Empty / one-liner intent** — interview anyway (batch 1 establishes scope); never expand
  emptiness into invented requirements.
- **Input is already a PRD/spec** — treat as `--prd` even without the flag; normalize, don't
  re-interview what's answered.
- **Single-node intent** — PRD + one prompt + one optional bead. No DAG, no lanes, plan.md is
  a paragraph.
- **No lean map** — point to `promper bootstrap` / `/promper:setup`, then continue with
  classify (it works mapless: `inMap` goes false, routing falls back to the in-session list).
- **`bd` absent** — Phase 3 skipped, noted in plan.md; graph.json keeps `"beads": null`.
​
## Codex portability (per phase)
​
| Phase | Codex behavior |
|---|---|
| 1 (PRD) | Pure prose — identical. |
| 2 (classify) | `npx @ninjamin/promper classify` (works cache-cold); else manual map walk, flagged as non-deterministic. |
| 3 (beads) | `bd` is host-independent; same opt-in. |
| 4 (roles/tools) | `npx @ninjamin/promper hydrate`; else read the agent's `.md` via the map `roots` directly. lean-ctx table omitted when no `ctx_*` tools. |
| 5 (prompts/run) | Prompts identical. `--run` degrades to sequential inline execution — no Agent tool assumed. |
| Gate hand-off | Skipped — hooks don't exist on Codex; nothing depends on them. |
