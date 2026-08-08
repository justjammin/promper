---
name: horizon
description: >
  The visual-validation gate of promper:orbit. Renders the pipeline's
  plan.json through a fixed, portable HTML template served by a tiny local Elysia node server,
  lets the user edit fields and answer open questions in the browser, and captures the result
  as feedback.json (JSON in, JSON out). Use as Phase 2 of orbit, or standalone to visually
  validate any JSON plan shape. Triggers on: "horizon", "validate this plan visually", "open
  the review surface", "/promper:horizon <plan.json>".
---

# horizon — visual validation gate (JSON in · HTML render · JSON out)

Horizon is the last surface the user inspects before the plan collapses into execution. It
turns `plan.json` into a reviewable HTML page, captures edits/answers/approvals, and writes
`feedback.json`. It uses a **fixed template + JSON contract**: no bespoke
artifact authoring per run — genesis emits the shape, Horizon renders it.

## Fixed template, not per-run artifacts

Horizon is narrow and deterministic: one template, one schema in (`plan.schema.json`), one
schema out (`feedback.schema.json`). The agent never hand-writes HTML — it just serves the shape.

## Files

```
horizon/
  SKILL.md                  this file
  schemas/plan.schema.json      input contract (the orbit plan spine)
  schemas/feedback.schema.json  output contract (edits + answers + verdict)
  server/horizon-server.mjs     Elysia Node server and export CLI
  server/validation.mjs         compiled schema + semantic boundary validators
  template/index.html           portable template shell
  template/render.js            section renderers keyed by plan.json top-level keys
  package.json / package-lock.json  reproducible runtime dependencies
```

## Workflow

1. Install pinned dependencies once with `npm ci` in this skill directory.
2. Ensure `plan.json` validates against `schemas/plan.schema.json`.
3. Start the server:
   ```
   node server/horizon-server.mjs .promper/<slug>/plan.json .promper/<slug>/horizon/feedback.json
   ```
4. Open `http://localhost:4317`. The template fetches `/api/plan` and renders one section per
   top-level key (positioning, evidence, domainModel, patterns, risks, openQuestions, scope).
   Unknown keys fall back to a JSON dump, so any shape renders.
5. Long-poll `GET /api/poll` **in the foreground** until `{ ready: true }`. Never background the
   poll with `nohup` / `&` / `disown` unless the harness has a completion-aware background
   facility that resumes the same agent. If the poll dies, just re-poll — `feedback.json` is
   written on submit and is never lost.
6. On `verdict == approved`: merge `decisions[].edit` / `decisions[].answer` back into
   `plan.json`, then proceed to Phase 3.
   On `verdict == changes-requested`: loop back — to `genesis` if `approvals.positioning` or
   `approvals.evidence` is `change`; to `sideeye` if `approvals.patterns` is `change`.
7. `POST /api/end` (or the browser "Approve & send") ends the session.

### Portable export

Create a single self-contained review file when the recipient cannot run the local server:

```
node server/horizon-server.mjs export .promper/<slug>/plan.json .promper/<slug>/horizon.html
```

The command validates the plan before writing, embeds the plan and renderer, and emits no
external script dependency. Open `horizon.html` directly with `file://`. Export mode makes no
API request; submitting downloads a validated-shaped `feedback.json` for return to the agent.

## Trust boundary

The server compiles the plan, feedback, and tracker-status schemas once at startup. It
validates the initial plan and every `POST /api/plan`, `POST /api/feedback`, and
`POST /api/status` request before mutating memory or writing files. Invalid input receives a
structured `400` response and leaves the previous plan, status, feedback, and snapshot intact.

Feedback also enforces semantic gates:

- feedback `slug` equals `plan.meta.slug`;
- `approved` has all seven canonical approvals and none marked `change`;
- `changes-requested` has at least one section marked `change`;
- every blocking open question has a non-empty answer before approval.

The renderer and tracker construct untrusted labels with DOM nodes and `textContent`; plan
keys, phase labels, and payload strings are never interpolated into `innerHTML`.

## Design-system rule

The template ships minimal, portable CSS and injects no design system. When the plan previews a
specific product's UI, restyle the template to that product's design tokens before serving, so
the surface faithfully represents the subject. State which design source was used.

## Gate (Phase 2 → 3)

```
HORIZON COMPLETE
Verdict:   [approved | changes-requested]
Edits:     [N field edits, M answered questions]
Sections:  [per-section approve/change]

approved        -> proceed to execution (breakdown | singularity)
changes-requested -> loop to [genesis | sideeye] per flagged section
```

## Rules

- **One template, any shape.** Do not fork the template per run. Extend `render.js` renderers if
  a new top-level key becomes canonical in `plan.schema.json`.
- **JSON is the only contract.** Input = `plan.schema.json`; output = `feedback.schema.json`.
  Nothing else crosses the browser boundary.
- **Foreground poll** unless a verified wake-path exists. Feedback is durable on disk regardless.
- **Portable output.** The exported file must render directly from `file://`, make no API
  request, and contain no external script dependency. Server mode continues to use `/api/plan`.
