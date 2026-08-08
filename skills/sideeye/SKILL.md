---
name: sideeye
description: Decide which architecture, backend, and API patterns to use — and which to reject — with a skeptical staff-engineer lens, then hold that decision to evidence. Two modes. SELECT (nothing built yet) for "which pattern fits here", "do I need a queue/cache/circuit breaker", "what API shape", "how should I structure this service", "which of these approaches". REVIEW (artifact exists) for tickets, plans, architectures, pull requests, diffs, incidents. Both modes reject patterns whose justifying pressure is absent, prefer the simplest credible option, and record each rejection with the missing evidence named. Use for design decisions, pattern selection, API and schema design, technology choice, code review, design review, ticket refinement, reliability review, incident follow-up, or devil's-advocate analysis. Runs solo (one skeptic, the default) or as the MAGI tribunal — a three-core Mixture-of-Experts (Melchior-1 / Balthasar-2 / Casper-3) that each write a plan to a shared PROPOSAL.md and cast a strict binary APPROVE/DENY vote for a deadlock-free consensus verdict. promper:orbit selects the tribunal per phase.
---

# Sideeye

Improve the outcome, not the argument. Make the strongest case for the proposal, then test it against code, runtime evidence, operational limits, and simpler alternatives.

## Mode

Pick one before doing anything else. The catalogs are the same in both; the entry point and the output differ.

| | **SELECT** | **REVIEW** |
|---|---|---|
| Trigger | Nothing built yet. "Which pattern fits?", "Do I need X here?", "What API shape?" | An artifact exists: ticket, plan, PR, diff, incident |
| Question | *Which pattern does my pressure select?* | *Does the observed pressure justify this choice?* |
| Card fields used | `Pressure` → `Valid use` → `Required evidence` | `Reject when` → `Failure modes` → `Adversarial questions` |
| Workflow | Steps 0–3, then 6–8 | Steps 0–8 |
| Output | Selection template | Review template |

The catalogs read both directions. Every card carries `Pressure` (what selects it) and `Reject when` (what disqualifies it). SELECT walks in, REVIEW walks out.

Mixed request — "here's my plan, and what should I use for the parts I haven't designed?" — run REVIEW on what exists, then SELECT on the gaps. Say which findings came from which.

### REVIEW branches

REVIEW has two explicit branches:

- **design-review branch** — plans, architecture documents, tickets, incidents, and other
  non-code artifacts use the existing pattern workflow below.
- **code-review branch** — pull requests, diffs, produced code, and Orbit Phase 3b use the
  fixed-point contract below. Orbit must invoke this branch explicitly.

Before a code-review branch dispatch:

1. Resolve the recorded fixed point as a commit (for example,
   `git rev-parse --verify <ref>^{commit}`). An invalid ref is a blocking error.
2. Compute the **scoped diff** from that commit to the review target. An empty scoped diff is
   a blocking error. In either case, **fail before dispatch**; do not start reviewers or MAGI.
3. Discover the originating PRD and repository standards sources. Prefer explicit paths, then
   the active `.promper/<slug>/PRD.md`; standards include in-scope `AGENTS.md`,
   `CLAUDE.md`, project conventions, lint config, and test policy.
4. Dispatch two independent axes, in parallel when the host supports it and sequentially
   otherwise. Never feed one axis's verdict into the other:
   - **Standards** checks documented repo rules. Keep documented violations separate from
     heuristic smells.
   - **Spec** checks every PRD acceptance criterion and reports missing requirements, scope
     creep, and incorrect implementations.

Write `sideeye-review.md` with literal `## Standards` and `## Spec` sections. Each axis
has its own evidence, findings, verdict, confidence, finding count, and worst finding.
Under `--tribunal magi`, run three votes and one tally **per-axis**; never collapse the six
votes into one consensus. Use separate proposal artifacts such as
`PROPOSAL-standards.md` and `PROPOSAL-spec.md`.

## Tribunal — solo vs MAGI

Orthogonal to SELECT/REVIEW. Both modes run under one of two tribunals:

| | **solo** (default) | **magi** |
|---|---|---|
| Agents | One skeptic runs the whole workflow | Three MoE cores judge in parallel, then vote |
| Use when | Normal design/review, bounded blast radius | High blast radius, irreversible, security-sensitive, or a contested pattern choice |
| Output | The SELECT/REVIEW template as-is | Same template + a `## MAGI Tribunal` block carrying the three votes and the consensus |
| Selected by | Default | `--tribunal magi`, or promper:orbit passes it for the phase |

Solo is the existing behavior — nothing changes. `magi` layers a deadlock-free voting tribunal
on top of the same catalogs, workflow, and rules below. Every core runs the full Required
workflow (calibrate → route → judge) from its own persona lens; the personas change the *lens*,
never the evidence standard in `judge-protocol.md`.

### MAGI protocol

1. **Seed.** The orchestrator writes the artifact/context, review axis, and exact sideeye
   question into a shared `PROPOSAL.md` (template: `magi/PROPOSAL.template.md`), plus the
   calibration line so all three cores judge the same stated stage. The code-review branch
   creates one proposal per-axis.
2. **Preflight.** Install the locked validator dependency once with `npm ci` in this skill
   directory. Then verify that the active harness has a callable `bd mail` delegate before
   spawning. If no delegate is configured, stop the MAGI path with an actionable message to
   configure `mail.delegate` or `BEADS_MAIL_DELEGATE`; never fabricate votes or fall back to
   a simulated consensus.
3. **Deliberate.** Spawn the three cores as subagents with the personas and requested
   hyperparameters in `magi/cores.json`:
   - **Melchior-1** — the Scientist (temp 0.2). Pure logic, probability, tactical efficiency,
     structural preservation, resource optimization. Emotion/ethics stripped out.
   - **Balthasar-2** — the Mother (temp 0.7). Human alignment, safety, preservation of life;
     balances tactical logic against ethical weight and risk.
   - **Casper-3** — the Woman (temp 1.2, hard cap). Intuition, subjectivity, high-entropy paths;
     may defy raw logic or safety for a high-risk/high-reward alternative.
   Each core appends its own detailed markdown section (calibration, findings, pattern verdicts,
   rationale) to `PROPOSAL.md` under its heading. Treat per-core hyperparameters as advisory
   unless the host proves it can honor them; record the effective behavior in the report.
4. **Vote.** Each core ends by emitting **one** strict JSON block matching
   `magi/schemas/vote.schema.json` and sending it to the tribunal inbox via
   `bd mail send magi/tribunal -s "vote:<core>"`:
   ```json
   { "core_name": "Melchior-1 | Balthasar-2 | Casper-3",
     "short_rationale_paragraph": "one concise paragraph",
     "vote": "APPROVE | DENY" }
   ```
   **Abstaining is forbidden.** The vote is binary. This is what guarantees no deadlock.
5. **Collect.** Read exactly one message for each core from `bd mail`. Reject duplicates,
   replayed messages, missing cores, unknown cores, and malformed vote objects. Save the three
   collected JSON objects and pass them to the pure validator/tally CLI:
   ```
   node magi/magi-orchestrator.mjs --votes votes.json --out tribunal-report.md
   ```
   The CLI validates every object against `vote.schema.json` and requires the exact core-name
   set before tallying.
6. **Tally.** Resolve the validated votes by majority.
   Three binary votes cannot tie, so a verdict is always reached:

   | Votes | Consensus | sideeye verdict |
   |---|---|---|
   | 3 APPROVE | Unanimous approve | **Approve** |
   | 2 APPROVE / 1 DENY | Split approve | **Approve with changes** (fold the dissent's rationale into the finding list) |
   | 1 APPROVE / 2 DENY | Split deny | **Request changes** |
   | 3 DENY | Unanimous deny | **Reject approach** |

7. **Report.** Emit the normal SELECT or REVIEW output, then append the `## MAGI Tribunal` block
   (per-core vote + rationale, the tally, and the named dissent). In SELECT mode the consensus
   maps to the `## Recommendation` / `## Confidence`; a split lowers confidence by one level.

### MAGI files

```
magi/
  cores.json                hyperparameters + system-prompt personas for the 3 cores
  schemas/vote.schema.json  strict binary-vote contract (no abstain)
  magi-orchestrator.mjs     pure vote validation + tally + report CLI
  PROPOSAL.template.md      shared deliberation surface
```

### MAGI output block

```markdown
## MAGI Tribunal
| Core | Vote | Rationale |
|---|---|---|
| Melchior-1 | APPROVE / DENY | one paragraph |
| Balthasar-2 | APPROVE / DENY | one paragraph |
| Casper-3 | APPROVE / DENY | one paragraph |

**Consensus:** [Unanimous approve | Split approve | Split deny | Unanimous deny] → [sideeye verdict]
**Dissent:** [named core + the concern it raised, or "none"]
**PROPOSAL.md:** path to the full deliberation
```

## Required context

Always read [judge-protocol.md](references/judge-protocol.md) — the decision standard, evidence ladder, adversarial passes, and guarantee guardrails.

Then load **only** the domain catalogs the routing table below selects. Never load all of them; never load one "to check."

Load on demand, not by default:

- [coverage-index.md](references/coverage-index.md) — maps original source labels to canonical IDs. Needed only when reconciling a pattern name against its source material, or when a card seems to be missing.
- [source-notes.md](references/source-notes.md) — extraction provenance and technical corrections.
- [diagrams.md](references/diagrams.md) — when the artifact under review *is* a diagram, or the output should include one.

## Progressive domain routing

Load only catalogs whose signals appear. Route on the artifact in REVIEW mode, on the stated intent in SELECT mode:

| Signal in the artifact (REVIEW) | Signal in the intent (SELECT) | Load |
|---|---|---|
| Gateway, BFF, service discovery, dependency timeout, circuit breaker, bulkhead, aggregation, ports/adapters | "many clients", "calling a flaky/slow service", "one entry point", "swap implementations", "compose several services into one response" | [architecture-resilience.md](references/architecture-resilience.md) |
| Database/event dual write, message delivery, inbox/outbox, saga, CQRS, event sourcing, snapshot, temporal history, queue, backpressure, soft delete | "publish an event", "background job", "must not double-charge", "audit history", "what was true last March", "producer outruns consumer", "undo a delete" | [data-messaging.md](references/data-messaging.md) |
| Sidecar, mesh, migration from monolith, config service, failover, sharding/hash ring, blue-green, cache, legacy boundary | "deploy", "scale out", "make it faster", "split the monolith", "survive a node dying", "ship without downtime" | [infrastructure-delivery.md](references/infrastructure-delivery.md) |
| Class/interface refactor, SOLID, construction, wrappers, behavioral object patterns | "how do I structure these classes", "too many constructor args", "several algorithms for one job", "wrap a third-party API" | [object-design.md](references/object-design.md) |
| Logs, metrics, traces, health probes, incident, SLO, alert, dashboard, production debugging | "how will I debug this", "what should I measure", "when should it page me", "is it healthy" | [observability-operations.md](references/observability-operations.md) |

Routing examples:

- *(REVIEW)* Database update plus event publication → data/messaging; inspect `transactional-outbox` and `inbox-pattern`.
- *(REVIEW)* Small CRUD service proposing CQRS/event sourcing → data/messaging; reject absent independent-model or historical-reconstruction pressure.
- *(REVIEW)* Slow dependency/timeouts → architecture/resilience; inspect `circuit-breaker` and `bulkhead`.
- *(SELECT)* "Approve button must not charge twice if double-clicked" → data/messaging; `inbox-pattern` and idempotency keyed by business identity.
- *(SELECT)* "What API shape for work that pauses on a human?" → architecture/resilience for the boundary, observability for the run state; `202` + poll before holding a connection open.
- *(SELECT)* "Should this be one service or three?" → architecture/resilience plus data/messaging; `database-per-service` is `Reject` until bounded contexts are named.
- Incident/debugging work → observability/operations.

## Required workflow

0. **Calibrate.** State the system's actual stage in one line before judging anything: traffic, client count, team count, SLO, on-call, data volume, blast radius. `Unknown` is a valid answer and lowers confidence — it is not permission to assume enterprise scale. Most patterns in these catalogs require pressure a prototype, internal tool, side project, or portfolio piece does not have. **Calibration decides more verdicts than any other single input**, and skipping it is the most common way this skill produces confident, useless advice.
1. Restate intended outcome and acceptance criteria. In SELECT mode, restate what is being built and what must be true when it works.
2. Inspect ticket, changed code, tests, call/dependency paths, and available runtime evidence. In SELECT mode, inspect whatever exists — surrounding code, constraints, prior art — and say plainly when the answer is "nothing yet."
3. Separate observed facts, inferences, assumptions, and open questions.
4. *(REVIEW)* Make the strongest evidence-backed case for the proposed approach.
5. *(REVIEW)* Attack that case: correctness, boundaries, failure, operability, security, scale, migration, rollback, and unnecessary complexity.
6. Route each real pressure to candidate cards. **A named pattern is not evidence.** In SELECT mode, start from `Pressure` and `Valid use`; in REVIEW mode, start from `Reject when` and `Failure modes`.
7. Compare against deletion, direct code, existing platform capability, and the best credible alternative. The `Simpler default` field on each card is the baseline every candidate must beat.
8. Return a verdict, the smallest viable approach, and executable verification.

## Rules

- **A named pattern is not evidence.** Neither is a pattern's popularity, its presence in a well-known architecture, or the fact that it would be impressive to have built.
- **A rejection is a deliverable, not an omission.** Record it with the specific missing evidence named — "no measured contention", "one client", "zero instance churn" — plus the trigger that would flip it. *"We didn't need it"* is a shrug, not a record. In a repo that keeps ADRs, a rejected ADR ranks equal to an accepted one: a reader can tell the difference between a pattern skipped by accident and one rejected on stated grounds, and only the second reads as judgment.
- Rank findings: blocker, high, medium, low, or note.
- For each criticism: impact, trigger, evidence, and correction.
- Missing evidence lowers confidence; it does not prove failure.
- Do not invent scale, requirements, or failure modes. Establish them at Step 0 or mark them unknown.
- Fewer than four repeated instances: do not demand abstraction solely for deduplication.
- Prefer deletion, direct code, or an existing platform capability when sufficient.
- Preserve a valid goal when rejecting its proposed implementation.
- Approve good decisions plainly.
- Never claim "exactly once," safe retries, seamless failover, compliant soft deletion, consistent cache, or guaranteed rollback without naming scope and preconditions.

## Output — SELECT mode

```markdown
## Calibration
One line: traffic, clients, teams, SLO, on-call, data volume, blast radius. `Unknown` where unknown.

## Recommendation
The smallest thing that meets the need, in one or two sentences.

## Pattern candidates
| Pressure observed | Candidate | Verdict | Evidence | Risk if applied | Simpler alternative |
|---|---|---|---|---|---|
| ... | `canonical-id` | Apply / Reject / Investigate | ... | ... | ... |

## Rejected, and what would change it
| Candidate | Rejected because (missing evidence) | Would revisit if |
|---|---|---|
| `canonical-id` | "no measured contention" | "profiling shows one dependency exhausting a shared pool" |

## Build order
What to build now, what to defer, what to leave out permanently.

## Verification
How you will know the choice was right — a test, a measurement, a threshold.

## Confidence
High | Medium | Low: reason

## Explain like I'm 5
Two to five sentences using a plain analogy.
```

## Output — REVIEW mode

```markdown
## Verdict
Approve | Approve with changes | Request changes | Reject approach

## Calibration
One line: traffic, clients, teams, SLO, on-call, data volume, blast radius. `Unknown` where unknown.

## Ticket reality
- Intended outcome:
- Acceptance criteria:
- Evidence inspected:
- Assumptions and open questions:

## Findings
### [severity] Short finding
- Impact:
- Trigger:
- Evidence:
- Better approach:

## Pattern candidates
| Signal | Candidate | Verdict | Evidence | Risk | Simpler alternative |
|---|---|---|---|---|---|
| ... | `canonical-id` | Apply / Reject / Investigate | ... | ... | ... |

## Better ticket
- Scope:
- Implementation:
- Verification:
- Rollback or forward-recovery:

## Confidence
High | Medium | Low: reason

## Explain like I'm 5
Two to five sentences using a plain analogy.
```

No findings: say so, then list residual risks and testing gaps.

### Code-review branch output

```markdown
## Standards
**Verdict:** Approve | Approve with changes | Request changes | Reject approach
**Summary:** [finding count; worst finding]
### Findings
[documented-standard violations, then separately labeled heuristic smells]
### Evidence
[standards source and diff references]

## Spec
**Verdict:** Approve | Approve with changes | Request changes | Reject approach
**Summary:** [finding count; worst finding]
### Findings
[missing requirements, scope creep, incorrect implementations]
### Evidence
[PRD criterion and diff/test references]
```

With MAGI, append a `### MAGI Tribunal` block inside each axis section. Name each axis's
three votes, tally, consensus, and dissent independently.

## Worked example

The same finding, weak and then usable. The difference is not tone — it is that the second one can be acted on and argued with.

**Weak:**

> The crawler should use a proper job queue for reliability and scalability.

Names a pattern, asserts a benefit, cites nothing. Unfalsifiable, so it can only be obeyed or ignored.

**Usable:**

> ### [medium] Work queue contradicts the crawler's own rate limit
> - **Impact:** builds lease/attempt/DLQ semantics no worker will ever contend for.
> - **Trigger:** none — the design never exercises it. That is the problem.
> - **Evidence:** the spec sets a 1 req/sec token bucket *and* a queue with `status`/`attempts`. At 1 req/sec the crawl is single-threaded by construction; 16,027 URLs is one 4.5-hour pass. Concurrent workers are forbidden by the rate limit, so worker-death recovery — the reason `work-queue` exists — never occurs.
> - **Better approach:** a resumable cursor table (`url`, `fetched_at`, `etag`, `last_error`). Same crash-resumability, none of the queue semantics. Per the card, `work-queue` is `Reject` here: no horizontal workers, no ordering pressure, no DLQ need.

Then the row that makes it portable:

> | Signal | Candidate | Verdict | Evidence | Risk | Simpler alternative |
> |---|---|---|---|---|---|
> | SQLite queue, `status`/`attempts` | `work-queue` | **Reject** | 1 req/s forbids concurrent workers | semantics built, never exercised | resumable cursor table |

Same discipline applies to approvals. *"Good use of the outbox pattern"* teaches nothing; *"the outbox row and the state change commit in one local transaction, and the consumer is idempotent by order ID — duplicates are harmless"* names the invariant that makes it correct, so a later reader knows what would break it.
