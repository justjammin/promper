---
name: singularity
description: >
  Run a bounded, goal-directed accretion-collapse loop over a Promper work graph. Use for
  requests such as "run this until the acceptance criteria pass", "singularity", "adapt the
  plan as gaps appear", or `/promper:singularity <goal>`. Unlike `/promper:breakdown`, which
  compiles one finite project graph and stops, singularity can execute, evaluate evidence,
  append focused remediation nodes, collapse completed outputs, and resume until the goal
  converges or a hard event-horizon limit is reached. Plan-first by default: the first
  invocation presents the goal contract and initial graph, spawns no agents, and edits no
  target-project files unless `--run` is present or the user later approves execution.
  Execution is always bounded. Never use for an unbounded autonomous loop or a single prompt.
---

# singularity: bounded goal convergence

`/promper:singularity` runs a bounded accretion-collapse loop that expands a goal-directed
work graph, collapses completed branches into shared state, and repeats until the acceptance
criteria pass or an event-horizon limit is reached.

The product vocabulary is intentionally small:

- **Orbit:** one execute, collapse, and evaluate cycle.
- **Accretion:** adding justified remediation nodes to the graph.
- **Collapse:** reducing completed branch outputs into compact evidence and shared state.
- **Event horizon:** the hard execution boundary.
- **Singularity reached:** successful convergence.

This is not a swarm, a daemon, or a replacement for `/promper:breakdown`. Read
`reference/pe-principles.md`, `skills/promper/SKILL.md`, and `skills/breakdown/SKILL.md` first.
Reuse their goal, routing, role-inheritance, prompt, execution-placement, and optional Beads
contracts. Do not duplicate their classifier or hydration logic.

## Invocation

```text
/promper:singularity <goal>
/promper:singularity migrate the billing service to event sourcing --run
```

| Flag | Default | Purpose |
|---|---:|---|
| `--run` | false | Execute after presenting the goal contract and initial graph. |
| `--prd <path>` | none | Normalize an existing PRD instead of interviewing. |
| `--resume <slug-or-path>` | none | Resume an existing singularity state. |
| `--max-orbits <n>` | `4` | Maximum cycles for a new run; additional cycles granted on resume. |
| `--max-nodes <n>` | `12` | Maximum total graph nodes, including remediation. |
| `--threshold <0-100>` | `90` | Minimum weighted score required for convergence. |
| `--stall-limit <n>` | `2` | Stop after this many consecutive no-progress orbits. |
| `--no-beads` | false | Disable optional Beads issue creation. |
| `--out <dir>` | `.promper/<slug>/` | Override the artifact directory. |

Parse flags before interpreting the remaining text as the goal. `max-orbits`, `max-nodes`,
and `stall-limit` must be positive integers. `threshold` must be an integer from 1 through
100. Reject zero, negative, fractional, missing, and non-numeric values. Never infer an
unbounded mode, and reject any request to remove the orbit or node limits.

`--resume` accepts either a slug under `.promper/`, an artifact directory, or a path to its
`singularity.json`. Reject a new goal combined with `--resume`; the user must either resume
the existing goal or start a new run. Reject `--out` on resume when it points somewhere other
than the located artifact directory.

## Architectural boundary

`/promper:breakdown` remains the one-shot graph compiler. Singularity is a host-agent skill
that wraps the same concepts in this adaptive runtime:

```text
goal contract
  -> initial graph
  -> execute ready frontier
  -> collapse results
  -> evaluate acceptance criteria
  -> accrete justified gap-remediation nodes
  -> repeat
```

Do not add or call a model API from the Promper TypeScript CLI. Requirements judgment,
evaluation, remediation proposals, and synthesis stay in the host model. Use deterministic
operations for:

- domain classification through `promper classify`;
- agent lookup and role hydration through the existing map and `promper hydrate`;
- dependency readiness and stable graph order;
- score calculation from accepted criterion statuses;
- fingerprint generation and duplicate rejection;
- limit validation and event-horizon checks.

## Built-in agent shapes

Singularity ships four portable execution shapes. A shape describes responsibility and edit
posture; it is not a replacement persona or a new marketplace agent.

| Shape | Responsibility | Edit posture |
|---|---|---|
| `orchestrator` | Own the loop, state transitions, frontier selection, collapse, limits, and final report. Never execute specialist node work or spawn another singularity. | State and orchestration artifacts only. |
| `planner` | Normalize the goal, compile the initial graph, evaluate criteria, and propose the smallest evidence-backed remediation. | Planning artifacts only unless a routed task explicitly requires edits. |
| `researcher` | Gather facts, inspect systems, and produce cited evidence for a node. | Read-only by default. |
| `implementer` | Make scoped target-project changes and run the checks attached to a node. | May edit only after the plan gate is satisfied. |

The orchestrator is the parent controller and never becomes a child node. Assign each graph
node a `shape` of `planner`, `researcher`, or `implementer` from its action. Then apply the
standard Promper role tiers: visible in-session specialist, lean-map specialist, then the
generic fallback. A routed specialist's persona remains the role; its shape only constrains
how it works. When no specialist exists, use the matching generic shape, record the role
coverage gap, and continue. Never invent a specialist identity.

Every generated node prompt must state its shape and must forbid running
`/promper:singularity` recursively.

## Goal contract

Before compiling the initial graph, normalize the request into `PRD.md` with these sections:

1. Goal and rationale.
2. Inputs and relevant systems.
3. Deliverables.
4. Numbered, testable acceptance criteria.
5. Positive integer criterion weights.
6. Blocking criteria.
7. Constraints and non-goals.
8. Available tools and agent sources.
9. Safety limits.
10. Open questions and explicit assumptions.

Acceptance IDs are stable and sequential (`AC-1`, `AC-2`, ...). Each criterion has a positive
integer weight and an explicit `blocking` boolean. Do not begin a run without at least one
testable criterion and a non-zero total weight.

For a rough goal, ask two or three material questions per batch, at most two batches. Ask only
about answers that change scope, acceptance, constraints, or safety. Infer safe defaults and
record them as assumptions. With `--prd`, normalize the supplied file without interviewing;
mark unresolved requirements `[OPEN — ask]`. A required open item blocks execution until the
user resolves it.

## Artifacts and source of truth

Use the breakdown package where practical:

```text
.promper/<slug>/
  PRD.md
  graph.json
  plan.md
  prompts/
    node-n1.md
    node-n2.md
  singularity.json
  orbits/
    orbit-001.md
    orbit-002.md
  collapses/
    node-n1.md
    node-n2.md
  RESULT.md
```

Paths stored in state are relative to the artifact directory. `singularity.json` is the
runtime source of truth; `graph.json` remains the complete append-only node history. Planning
may create or update only these orchestration artifacts. Source, product, infrastructure, and
other target-project edits require `--run` or later explicit approval.

### `singularity.json`

```json
{
  "schema_version": 1,
  "command": "promper:singularity",
  "goal": "Migrate the billing service to event sourcing",
  "status": "planned",
  "orbit": 0,
  "score": 0,
  "threshold": 90,
  "no_progress_orbits": 0,
  "limits": {
    "max_orbits": 4,
    "max_nodes": 12,
    "stall_limit": 2
  },
  "criteria": [
    {
      "id": "AC-1",
      "text": "All writes use the event log as the source of truth",
      "weight": 3,
      "blocking": true,
      "status": "unknown",
      "evidence": []
    }
  ],
  "graph_file": "graph.json",
  "result_file": null,
  "stop_reason": null
}
```

Allowed top-level statuses are `planned`, `running`, `converged`, `event_horizon`, `stalled`,
`blocked`, and `failed`. Allowed criterion statuses are `pass`, `partial`, `fail`, and
`unknown`.

Criterion values are deterministic:

```text
pass    = 1.0
partial = 0.5
fail    = 0.0
unknown = 0.0
```

Calculate the score after every accepted evaluation:

```text
score = round(
  100 * sum(criterion.weight * status_value) /
  sum(criterion.weight)
)
```

A blocking criterion that is not `pass` prevents convergence regardless of score.

### `graph.json`

Preserve the existing breakdown root and node fields. Runtime fields are a compatible
extension:

```json
{
  "id": "n4",
  "domain": "testing",
  "action": "Add replay and idempotency integration tests",
  "deps": ["n2"],
  "parallel": true,
  "agent": "integration-test-specialist",
  "shape": "implementer",
  "tools": [],
  "execution": "subagent",
  "acceptance": ["AC-3"],
  "prompt_file": "prompts/node-n4.md",
  "status": "pending",
  "orbit_created": 2,
  "fingerprint": "testing:add-replay-and-idempotency-integration-tests:AC-3",
  "output_ref": null,
  "attempts": 0
}
```

Runtime node statuses are `pending`, `ready`, `running`, `completed`, `failed`, `blocked`, and
`superseded`. Initial nodes use `orbit_created: 0`. Node IDs are monotonic and never reused.
Completed nodes and their collapse artifacts are immutable except for explicit metadata
corrections, which must be recorded in the next orbit note. Never erase a failed, blocked,
superseded, or interrupted attempt.

## Phase 0: plan and approval

1. Build or ingest the goal contract.
2. Compile the smallest useful initial graph using the established breakdown logic. Preserve
   breakdown's node contract and add the runtime fields above.
3. Route every node with `promper classify "<node action>" --json`. Use the same one-time
   rephrase and labeled manual fallback as breakdown when classification is unavailable or
   unmapped.
4. Assign the node shape, routed role, tool suggestions, prompt, and execution placement using
   Promper's existing map, `promper hydrate`, and inline-versus-subagent heuristic.
5. Create optional Beads issues unless `--no-beads` is present. Beads failures never block the
   run; record the omission in `plan.md` and keep `graph.json.beads` null.
6. Write `PRD.md`, `graph.json`, `plan.md`, node prompts, and `singularity.json` with status
   `planned`.
7. Present the goal summary, acceptance criteria, initial graph, safety limits, and expected
   execution placement.
8. Stop with the headline `PLANNED` unless `--run` is present or the user explicitly approves
   execution afterward.

The initial invocation has zero spawns without `--run`. Artifact creation is not permission
to edit target-project files.

## Phase 1: determine the ready frontier

A node is ready only when all of these are true:

- its status is `pending`;
- every dependency has status `completed`;
- it has not been superseded;
- no equivalent active or completed node already represents its fingerprint.

At orbit start, convert eligible nodes to `ready` in stable graph-array order. Leave nodes
with failed or blocked dependencies pending until evaluation decides whether to remediate or
stop. Select the whole ready frontier unless doing so would violate an explicit safety or
resource constraint.

Run mutually independent, parallel-safe nodes concurrently when the host supports subagents.
Otherwise run them sequentially in stable graph order. Use Promper's placement heuristic:

- light, low-noise work runs inline;
- noisy exploration runs in a subagent;
- parallel-safe siblings run in subagents when available;
- risky or isolation-sensitive work runs in a subagent.

Never report concurrency when the host ran nodes sequentially.

## Phase 2: execute

For every selected node:

1. Confirm the plan gate is satisfied, mark the node `running`, increment `attempts`, set the
   state to `running`, and update its Beads issue when enabled.
2. Resolve dependency slots from `output_ref` collapse artifacts. Do not replay full raw
   transcripts into downstream prompts.
3. Execute with the routed persona, shape constraints, and suggested tools. A child node must
   not invoke singularity, mutate graph state, or create sibling nodes.
4. Capture outcome, changed files or artifacts, concrete evidence, tests or checks, unresolved
   concerns, and confidence.
5. Mark the node `completed`, `failed`, or `blocked`. Close or annotate its Beads issue.

A failed node is not blindly rerun. It remains in history. Only an evaluator-proposed,
materially changed action with new evidence or a different method may become a new remediation
node. An interrupted `running` node is handled only by the resume rules below.

User cancellation takes effect after the current safe tool boundary. Do not start another
node after cancellation is observed.

## Phase 3: collapse

For each node that reached a terminal execution status in the current orbit, write
`collapses/node-<id>.md`:

```markdown
# Collapse: n4

## Outcome
Completed | Partial | Failed | Blocked

## Material result
Concise description of what changed or was learned.

## Evidence
- Test result, file path, command output, citation, or artifact reference

## Acceptance criteria affected
- AC-3: pass | partial | fail | unknown

## Open concerns
- Remaining issue

## Reusable output
The minimum context downstream nodes need.
```

Collapse preserves evidence and artifact references, removes verbose exploration, merges
duplicate findings, and exposes only the dependency context downstream nodes need. It never
deletes execution history, hides conflicting evidence, or claims success without evidence.
Set the node's `output_ref` to its collapse artifact after the artifact exists.

## Phase 4: evaluate

After the frontier finishes and its outputs collapse, run one goal-evaluation pass against:

- the complete acceptance-criteria list;
- all relevant collapse artifacts;
- produced files and test results;
- the current graph state;
- explicit constraints and non-goals.

The evaluator returns this strict structure:

```json
{
  "criteria": [
    {
      "id": "AC-1",
      "status": "pass",
      "evidence": ["collapses/node-n2.md#evidence"],
      "reason": "Writes append to the event store and projections are derived."
    }
  ],
  "blocking_gaps": [],
  "gaps": [
    {
      "criterion_id": "AC-3",
      "description": "Replay idempotency is not demonstrated under duplicate delivery.",
      "evidence_missing": "An integration test that replays duplicate events.",
      "proposed_action": "Add duplicate-delivery replay integration coverage.",
      "suggested_deps": ["n2"],
      "domain_signals": ["integration test", "idempotency", "event replay"]
    }
  ],
  "decision": "expand",
  "confidence": 0.86
}
```

Allowed decisions are `converge`, `expand`, `stalled`, and `blocked`. Reject criterion IDs or
statuses outside the goal contract rather than silently adding them. A `pass` is accepted only
when it has at least one concrete evidence reference that can be resolved to a collapse,
artifact, changed file, test result, command result, or citation. Downgrade an unsupported
`pass` to `unknown` and record why.

After accepting the statuses, recalculate the score using the deterministic formula. An orbit
made progress when either the score increased or at least one criterion's numeric status value
increased. Reset `no_progress_orbits` to zero on progress; otherwise increment it. Evidence may
invalidate an earlier status, so evaluation is allowed to regress a criterion honestly.

The evaluator proposes judgment. The orchestrator owns schema validation, score calculation,
duplicate checks, convergence, and boundaries.

## Phase 5: convergence check

Declare `SINGULARITY REACHED` only when every condition is true:

1. `score >= threshold`;
2. every blocking criterion is `pass`;
3. the evaluator reports no blocking gaps;
4. every `pass` includes at least one concrete evidence reference;
5. no pending or ready node affects an unsatisfied blocking criterion.

Never converge solely because the evaluator chose `converge`. If the evaluator says
`converge` but the predicate fails, treat the unmet items as gaps. Accrete them when they are
actionable; otherwise stop honestly at the applicable boundary.

On convergence, set `status: "converged"`, clear `stop_reason`, write `RESULT.md`, set
`result_file`, and persist state before reporting success.

## Phase 6: accretion

When the accepted decision is `expand`:

1. Convert each meaningful gap into at most one focused remediation node.
2. Reject a gap that is duplicate, merely stylistic when style is not a criterion, outside
   the goal or constraints, unsupported by evidence, or too vague to test.
3. Generate a stable fingerprint from normalized domain, normalized action, and sorted
   acceptance IDs. Normalize by Unicode NFKC, lowercase, trim, replace runs of non-alphanumeric
   characters with one hyphen, and trim edge hyphens. Format:
   `<domain>:<action>:<AC-1,AC-3>`.
4. Reject an equivalent fingerprint already present in a pending, ready, running, completed,
   failed, blocked, or superseded node. A materially different action must explain what new
   method or evidence makes it different.
5. Route the action with `promper classify`, assign its shape and existing Promper role, and
   generate its prompt through the standard contracts.
6. Append the node to `graph.json` with the next monotonic ID and the orbit just completed as
   `orbit_created`.
7. Add at most the smallest set of nodes that could close the observed gaps. Prefer blocking
   and higher-weight criteria when fewer slots remain than accepted gaps.
8. Never append beyond `max_nodes`.

Record every accepted and rejected proposal in the orbit file. Do not create speculative
nice-to-have branches.

## Phase 7: event-horizon checks

Run convergence first, then stop before another orbit when any condition is true:

- completed orbit count is equal to `max_orbits`;
- total graph node count is equal to `max_nodes` and unresolved work remains;
- no executable frontier exists while blocking gaps remain;
- score and criterion values made no progress for `stall_limit` consecutive orbits;
- every proposed node is duplicate or non-actionable;
- required access, credentials, tools, infrastructure, or user decisions are unavailable;
- the user interrupted or stopped the run;
- execution failed in a way that leaves no safe, evidence-backed remediation.

Use only these stop reasons:

```text
max_orbits
max_nodes
stalled
duplicate_expansion
blocked_dependency
missing_access
user_stopped
execution_failure
```

Map the stop to state honestly:

| Condition | Status |
|---|---|
| `max_orbits`, `max_nodes`, `user_stopped` | `event_horizon` |
| repeated no progress or duplicate-only expansion | `stalled` |
| unavailable access or dependency | `blocked` |
| unrecoverable execution or state failure | `failed` |

Never label a bounded, stalled, blocked, or failed stop as success. Write or update
`RESULT.md` with the partial result before reporting the boundary.

## Orbit transaction

An orbit follows this stable order:

1. Check pre-orbit boundaries and calculate the ready frontier.
2. Increment the displayed orbit number and execute the frontier.
3. Collapse terminal node outputs.
4. Evaluate once and calculate score deterministically.
5. Check convergence.
6. If not converged, accrete the minimum valid remediation.
7. Apply event-horizon checks.
8. Write `orbits/orbit-NNN.md`, then persist `graph.json` and `singularity.json`.

Write one orbit record per completed orbit:

```markdown
# Orbit 002

## Frontier
- n4 — Add replay and idempotency integration tests
- n5 — Verify projection rebuild behavior

## Execution
- n4 → subagent `integration-test-specialist`
- n5 → inline

## Collapse
- n4 → `collapses/node-n4.md`
- n5 → `collapses/node-n5.md`

## Evaluation
- Previous score: 62
- Current score: 83
- Criteria improved: AC-2, AC-3
- Remaining blocking gaps: AC-4

## Accretion
- Added n6 for AC-4
- Rejected duplicate proposal for AC-3

## Boundary
- Orbit: 2 / 4
- Nodes: 6 / 12
- No-progress count: 0
```

Do not use background execution, detached processes, asynchronous promises, or an unattended
loop. Each tool action must finish at a safe boundary before the orchestrator advances state.

## Resume

`--resume` must:

1. locate the artifact directory and read `singularity.json` plus `graph.json`;
2. validate `schema_version === 1`, command identity, enums, criteria, positive weights, graph
   references, limits, and score inputs before executing;
3. reject a state already marked `converged`; a new goal requires a new artifact package;
4. recover every node left `running` by marking it `pending`, preserving its incremented
   `attempts`, and appending an interrupted-attempt note to the next orbit record;
5. continue with `state.orbit + 1` without deleting previous orbit or collapse artifacts;
6. preserve previous limits unless the user explicitly supplied an override. On resume,
   `--max-orbits <n>` grants `n` additional orbits by setting the effective total limit to
   `state.orbit + n`; show and record that effective limit. `--max-nodes <n>` remains a total
   graph cap and must not be lower than the current node count;
7. never silently lower the threshold. If the user explicitly lowers it, show old and new
   values and record the change before continuing;
8. preserve completed nodes and collapse artifacts exactly;
9. re-run ready-frontier and boundary checks before any execution.

Resume without `--run` validates and presents the recovered state, then stops `PLANNED`.
Resume with `--run` continues only after the validation report.

## Result output

On success, write `RESULT.md` with:

1. final outcome;
2. criterion-by-criterion status and evidence;
3. important artifacts and changed files;
4. verification performed;
5. assumptions;
6. residual non-blocking risks;
7. graph and orbit summary.

Then report:

```text
SINGULARITY REACHED

Score: 96 / 100
Orbits: 3 / 4
Nodes executed: 8
Blocking criteria: 4 / 4 passed
Result: .promper/<slug>/RESULT.md
```

On a bounded or blocked stop, update `RESULT.md` as a partial report. List every incomplete
criterion and the precise missing evidence or access:

```text
EVENT HORIZON REACHED

Reason: max_orbits
Score: 82 / 100
Unresolved blocking criteria:
- AC-4 — rollback behavior has not been demonstrated

Resume:
  /promper:singularity --resume <slug> --max-orbits 2 --run
```

Use readable operational output:

```text
SINGULARITY // ORBIT 2

Frontier: n4, n5
Execution: 1 inline, 1 subagent
Collapsed: 2 node outputs
Score: 62 → 83
Decision: ACCRETE
Boundary: orbit 2/4 · nodes 6/12
```

Allowed headlines are `PLANNED`, `ORBIT N`, `ACCRETING`, `COLLAPSING`,
`SINGULARITY REACHED`, `EVENT HORIZON REACHED`, `ORBIT STALLED`, and `BLOCKED`. Keep node,
dependency, score, criterion, and evidence literal.

## Host and dependency compatibility

### Claude Code

- Use Agent/Task execution when available.
- Respect Promper's routing decision and edit-gate contract.
- Record a `mixed` decision for a multi-agent run unless one routed specialist clearly owns
  the whole operation.
- Keep a no-`--run` invocation at zero spawns.

### Codex and other hosts

- Keep prompts and artifacts portable prose.
- Use a host subagent tool when present. Otherwise execute ready nodes sequentially inline in
  dependency order and say that execution was sequential.
- Skip Claude-specific hooks when absent.
- Keep scoring, collapse, accretion, evaluation, and stop behavior identical.

### Missing optional dependencies

- Missing `bd`: continue without Beads and record the omission.
- Missing lean map: use the matching generic agent shape and record the role coverage gap.
- Missing lean-ctx: omit its tool suggestions.
- Missing classifier CLI: perform breakdown's manual domain walk and label routing
  non-deterministic.

## Non-negotiable safety and cost controls

- No infinite or unbounded loop.
- No recursive child singularity command.
- No node may spawn or request another singularity run.
- Never exceed configured orbit or node limits.
- Never repeat an equivalent fingerprint.
- Never retry without a changed action or new evidence.
- No background, detached, or unattended execution.
- No success without concrete criterion evidence.
- No expansion outside the original goal, constraints, and non-goals.
- No target-project edits before the plan gate is satisfied.
- No fabricated access, test output, artifacts, or evidence.
- No automatic publish, merge, release, or deployment unless the original goal explicitly
  includes it and the user separately authorizes the external action.
- Stop after the current safe tool boundary when the user cancels.

Prefer collapse artifacts over replaying raw output. Preserve the full graph history while
keeping the orchestrator's active context compact.
