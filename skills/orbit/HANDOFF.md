# Promper Orbit — implementation handoff

Last updated: 2026-08-08. Authoritative implementation now lives in this repository.

## Ready state

The complete pipeline is packaged:

`Genesis → Sideeye SELECT → Horizon → Execute (Breakdown | Singularity) → Sideeye REVIEW`

| Area | State | Evidence / tracker |
|---|---|---|
| Skill packaging | Ready — Orbit, Genesis, Horizon, and Sideeye install recursively with support assets | `ja-oth.1`, `ja-oth.7` |
| Breakdown TDD tiers | Ready — engineering nodes receive deterministic write-first, gated-followup, and post-ship tiers | `ja-bkq` |
| Breakdown delta interview | Ready — validated plans derive known requirements and ask residual gaps only | `ja-oth.7` |
| Sideeye REVIEW | Ready — fixed-point and non-empty-diff preflight; independent Standards and Spec axes | `ja-oth.2` |
| Horizon trust boundary | Ready — compiled schemas, semantic gates, structured 400 responses, no mutation on rejection, text-node rendering | `ja-oth.3` |
| MAGI | Ready — host-driven live cores plus pure exact-set validator/tally CLI; 8/8 binary combinations resolve | `ja-oth.4` |
| Horizon export | Ready — validated single-file export, embedded/offline mode, safe script embedding, feedback gates | `ja-oth.5` |
| Tracker | Ready — optional non-blocking observer, schema-valid state-only lifecycle feed | `ja-oth.6` |

MAGI requires a callable `bd mail` delegate before live core dispatch. Per-core sampling settings
are advisory unless the active host records that it honored them; persona prompts remain the
portable behavioral contract. The CLI never simulates agents or manufactures votes.

## Runtime commands

Install skill-local dependencies reproducibly:

```sh
npm ci --prefix skills/horizon --no-audit --no-fund
npm ci --prefix skills/sideeye --no-audit --no-fund
```

Serve or export Horizon:

```sh
node skills/horizon/server/horizon-server.mjs plan.json feedback.json --port=4317
node skills/horizon/server/horizon-server.mjs export plan.json horizon.html
```

Validate and tally collected MAGI votes:

```sh
node skills/sideeye/magi/magi-orchestrator.mjs --votes votes.json --out tribunal-report.md
node skills/sideeye/magi/magi-orchestrator.mjs --selftest
```

## Verification

Root `npm test` installs both skill-local lockfiles and runs the complete Node test suite. The
release gate also runs `npm run build`, manifest freshness, classifier probes, Horizon API/export
tests, MAGI self-test, packaging checks, and source-hygiene scans.

Direct `file://` navigation is blocked by the automation browser's security policy. The export
has deterministic CLI, schema, hostile-script, embedded-mode, and no-external-script coverage;
the remaining manual smoke check is to open an exported file locally, answer every blocking
question, download feedback, and exercise the tracker DEMO/MODE controls. This is visual QA, not
a runtime or packaging blocker.

## Source-of-truth rules

- JavaScript `.mjs` is the only runtime source; handwritten TypeScript mirrors are absent.
- Generated server logs, snapshots, and simulated tribunal reports are not shipped.
- `plan.json` is the pipeline spine.
- Tracker payloads carry state only—never intent, plan, votes, verdicts, rationales, or evidence.
- Review reports preserve separate `## Standards` and `## Spec` axes.
- Live bug remediation starts from a red-capable reproduction and a Beads issue.
