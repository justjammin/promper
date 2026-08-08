<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/promper-stacked-light.svg">
    <img alt="Promper — prim & proper prompts all the time" src="assets/promper-stacked.svg" width="300">
  </picture>
</p>

# promper

Promper is a prompt-engineering toolkit for Claude Code and Codex. It ships nine skills:

- **`/promper <intent>`**: turns a rough request into a clean, **role-grounded** prompt.
- **`/promper:breakdown <goal>`**: compiles a finite PRD, dependency graph, and prompt package.
- **`/promper:singularity <goal>`**: runs a bounded graph until its acceptance criteria pass or a hard limit stops it.
- **`/promper:orbit <intent>`**: drives the full Genesis → Sideeye → Horizon → Execute → Review pipeline.
- **`/promper:genesis <intent>`**: grounds a plan in repo evidence, positioning, and domain language.
- **`/promper:sideeye <plan-or-diff>`**: critiques pattern choices or reviews Standards and Spec independently.
- **`/promper:horizon <plan.json>`**: validates a plan through a schema-backed visual review gate.
- **`/promper:setup`**: rebuilds the lean routing map from installed agents.
- **`/prim`**: grades your agents against the prompt-engineering standard and hands out the "seal of approval".

## The idea

Here's the bet. Your installed agents *are* prompt engineering: each one's system prompt is a persona tuned for its domain. So the best `<role>` for your prompt isn't something you guess ("you are an expert…"). It's the specialist agent your task would route to. promper finds that agent itself — inline and token-lean — and borrows its persona.

```
raw intent
  → promper decomposes inline       →  bead_graph (usually one node)
  → walks the map, cheapest first   →  session list → index.json → <domain>.json
        → agent persona             ⇒  <role>   (inherited, not invented)
  → promper crafts the rest inline (Prompt Engineer agent on --deep)
        <context> <instructions> <examples> <constraints> <output_format>
  → engineered prompt(s) + plan     (nothing spawns until you say go)
```

**Who does what:** promper *makes* the prompt, *routes* to the agent, and *decides execution* · the agents *are* the roles · prim *guards* them.

| Command | Job | Stop point |
|---|---|---|
| `/promper` | Engineer one routed prompt. | The prompt and its execution placement are ready. |
| `/promper:breakdown` | Compile one finite project graph. | The PRD, graph, prompts, and lane plan are ready. |
| `/promper:singularity` | Execute and adapt a bounded graph. | Every required criterion has evidence and the score passes, or a safety limit stops the run. |
| `/promper:orbit` | Run the evidence → critique → visual gate → execution → review arc. | Reviewed output is complete, or a correctness gate blocks. |
| `/promper:genesis` | Create the evidence-backed plan spine. | `genesis.md` and `plan.json` are ready for critique. |
| `/promper:sideeye` | Select patterns or review a produced diff. | A verdict with separate Standards and Spec axes is ready. |
| `/promper:horizon` | Visually validate `plan.json`. | Approved feedback is captured, or requested changes loop upstream. |

## /promper

```
/promper write a tweet announcing my budgeting app
```

- **Portable (default):** you get a standalone, copy-paste prompt with the persona baked in. Take it anywhere.
- **`--run`:** promper engineers the prompt(s), presents the plan, then executes — each node runs inline or as a spawned subagent based on a per-node token decision.
- Flags: `--agent=<name>` to override the pick · `--target=portable|costar` · `--deep` to spawn the Prompt Engineer agent for heavy drafting (default crafting is inline).

The default skeleton is Claude-native XML. Pass `--target=costar` to emit CO-STAR for portable or non-Claude prompts.

## /promper:breakdown

```
/promper:breakdown migrate the billing service to event sourcing
```

The one-shot prompt expander. `/promper` engineers one prompt; `breakdown` engineers the
whole run. It starts with a batched requirements interview and turns your answers into a
PRD. From there, `promper classify` (the same deterministic trigger tables, zero LLM) splits
the work into domain nodes. If beads (`bd`) is installed, breakdown files an epic plus
per-node issues with dependencies; that part is opt-in and never blocks the run. Each node
inherits a routed persona and tool suggestions (lean map plus `promper hydrate`, with
lean-ctx prescriptions when present) and ends up as one engineered Claude-XML prompt with a
parallel-lane execution plan.

Artifacts land in `.promper/<slug>/`: `PRD.md`, `graph.json`, `plan.md`, and `prompts/`.
Breakdown presents everything and spawns nothing. When you're ready, `--run` executes the
plan with the same per-node inline-vs-subagent decision `/promper` uses.

Flags: `--no-beads` · `--prd <path>` (ingest an existing spec) · `--target=portable|costar` ·
`--out <dir>`. It runs on Claude Code and Codex alike; nothing depends on hooks, and every
phase states how it degrades when something is missing.

## /promper:singularity

```text
/promper:singularity migrate the billing service to event sourcing
/promper:singularity migrate the billing service to event sourcing --run
```

Singularity starts with the same goal contract and finite graph that breakdown uses. The first
command is a planning pass. It writes the orchestration package, shows the acceptance criteria
and safety limits, and stops before it touches project files or starts an agent. Add `--run`,
or approve the plan afterward, to begin execution.

One orbit executes the ready nodes, stores a compact collapse for each result, and checks the
evidence against every criterion. If a concrete gap remains, singularity can add one focused
remediation node for that gap. Equivalent work is rejected by a stable fingerprint. The loop
ends when the weighted score reaches the configured threshold and every blocking criterion has
evidence, or when an event-horizon condition such as `max_orbits`, `max_nodes`, missing access,
or repeated lack of progress stops it.

The runtime has four built-in agent shapes: `orchestrator` owns state and boundaries,
`planner` compiles and evaluates, `researcher` gathers evidence, and `implementer` changes the
project. These are fallback work shapes, not replacement personas. A routed specialist from
the Promper map still supplies the role whenever one is available.

Runs are resumable. State, orbit notes, collapse artifacts, and the partial or final result
live beside the breakdown files in `.promper/<slug>/`. A stopped run can continue without
discarding completed evidence:

```text
/promper:singularity --resume billing-event-sourcing --max-orbits 2 --run
```

Limits always stay finite. Defaults are `--max-orbits 4`, `--max-nodes 12`, `--threshold 90`,
and `--stall-limit 2`. Other flags are `--prd <path>`, `--no-beads`, and `--out <dir>`.
Without a subagent tool, Codex runs the same ready nodes sequentially and reports that choice;
the artifacts, scoring, accretion, collapse, and stop rules do not change.

## /promper:orbit

Orbit is the end-to-end path for work that needs disciplined discovery before execution. Genesis
builds the evidence-backed `plan.json`; Sideeye selects only supported patterns; Horizon captures
human edits and approval; Breakdown or Singularity executes; Sideeye then reviews the resulting
diff against independent Standards and Spec axes. Human gates remain unless `--run` is present,
and correctness failures always block.

Use the phase skills directly when the whole arc is unnecessary. Horizon can also export a
validated, self-contained offline review file, and MAGI can replace Sideeye's solo tribunal for
contested or high-blast-radius decisions.

## /prim

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/promper-seal-icon-bowtie-light.svg">
    <img alt="prim seal" src="assets/promper-seal-icon-bowtie.svg" width="84">
  </picture>
</p>

```
/prim                # pick agents to evaluate
/prim --all          # evaluate all (still confirms once)
/prim my-writer --fix
```

prim scores each approved agent 0–100 against the rubric, lists P0/P1/P2 findings with fixes, and writes a seal (`score ≥ 80 AND zero P0`) to `~/.claude/agents/.prim-seal.json`. Add `--fix` and it rewrites the agents that fail. That part is gated: you see a per-file diff and confirm each one. It also won't silently edit plugin-provided agents (those revert on `/plugin update`), so it offers you an override copy instead.

promper reads the prim ledger, so when it's about to inherit a role from an uncertified or weak agent, it warns you first.

## Layout

```
promper/
  .claude-plugin/      plugin.json (generated) + marketplace.json
  .codex-plugin/       plugin.json (generated) — the codex-side manifest
  plugin.source.json   canonical metadata both manifests are generated from
  tools/
    gen-manifests.mjs  `npm run build:manifests` — regenerates both manifests
  hooks/
    hooks.json         SessionStart + UserPromptSubmit + PreToolUse registrations
    inject-contract.mjs   SessionStart: injects the orchestration contract (below)
    contract.md            the contract text itself
    gate-prompt.mjs        UserPromptSubmit: deep-dive-vs-follow-up gate
    enrich-spawn.mjs       PreToolUse: role-bearing spawn-brief rewrite
  skills/
    promper/SKILL.md   the "make" skill (manual path: `/promper`)
    promper-setup/SKILL.md   builds the lean routing map (wraps `promper scan`)
    prim/SKILL.md      the "evaluate / certify" skill
    breakdown/SKILL.md the one-shot prompt expander (PRD → domains → beads → prompts)
    singularity/SKILL.md the bounded accretion-collapse runtime
    orbit/             full pipeline orchestrator, design, handoff, and tracker
    genesis/SKILL.md   evidence, positioning, and domain-model phase
    horizon/           schema-backed visual gate, server, and portable template
    sideeye/           SELECT/REVIEW critic plus MAGI tribunal
  src/                 the TypeScript engine (`scan`/`hydrate`/`brief`/`gate`/`classify`) — deterministic, zero LLM
  reference/
    pe-principles.md   shared source of truth (11 principles, XML skeleton, rubric)
```

## Active mode

Everything above is the **manual** path — you type `/promper` and it engineers a prompt,
plan-first, zero spawns. promper also runs **automatically**, via five hooks that ship with
the plugin (`hooks/hooks.json`), so the agent-walk happens without you remembering to invoke it:

| Hook | Event | What it does |
|---|---|---|
| `inject-contract.mjs` | `SessionStart` | Injects the routing + execution-decision + edit-gate contract as standing context — see `hooks/contract.md`. Runs every session start (startup/resume/compact/clear). |
| `gate-prompt.mjs` | `UserPromptSubmit` | Deterministic classifier (`promper gate`, no LLM): a session opener or a new substantial task nudges the model to run the agent-walk and record the routed agent, and re-injects the full contract (the SessionStart copy decays as context grows); an ordinary follow-up ("also...", "what about...", a short reply) stays silent. Biased toward under-triggering — it never nags. |
| `enrich-spawn.mjs` | `PreToolUse` (matcher `Agent\|Task`) | Deterministic role-bearing brief (`promper brief`, no LLM): rewrites a subagent's prompt **only when it adds real value** — a full persona (when a routed agent name is known) or a toolkit line (for an already-named agent). A spawn with nothing to add is left completely untouched, never wrapped in empty boilerplate. |
| `contract-gate.mjs` | `PreToolUse` (matcher `Edit\|Write\|MultiEdit\|NotebookEdit`) | The contract's teeth: denies edits to files **inside the active repo** until a fresh routing decision exists (`promper-decision-<session_id>.json`, any verdict, 60-min TTL, same repo root; the legacy global `promper-decision.json` is accepted as a permanent fallback). The denial message re-delivers the contract and the exact JSON to record. Writes outside the repo (including the state file itself) are never gated, so satisfying the gate can't deadlock. Fails open on any error. |
| `clear-decision.mjs` | `SessionEnd` | Re-arms the gate: clears **this session's** routing decision when the session ends, so the next session re-runs the agent-walk before its first repo edit. Session-scoped — never wipes a decision another live session still needs (same repo or not). Also sweeps session decision files older than the TTL so abandoned sessions don't accumulate state. |

The hand-off between the nudge and the rewrite is the session-scoped decision file
`~/.invoker/state/promper-decision-<session_id>.json` (the hooks substitute the concrete path
into the injected contract; environments without a session_id — e.g. Codex — use the global
`promper-decision.json`): when the agent-walk (Step 7.5 in `skills/promper/SKILL.md`) routes to
a specialist, it records `{"verdict", "repo", "agent", "reason", "ts"}` there (60-min TTL,
keyed to the git repo root); `enrich-spawn.mjs` reads it back and inherits that exact role on
the next general-purpose spawn in the same repo — routing happens once, in the model, and the
hooks stay deterministic.

**Off switch:** `PROMPER_ACTIVE=0` disables all five hooks. `/promper`, `/prim`,
`/promper:setup`, `/promper:breakdown`, and `/promper:singularity` are unaffected either way.
They stay available as the manual override.

**Caveats:**
- Verified on Claude Code CLI. Codex support (`.codex-plugin/plugin.json` + the same hooks) is
  shipped but **experimental** — not yet verified against a real Codex install.
- `UserPromptSubmit`'s `additionalContext` is CLI-only; the VSCode extension currently drops it
  ([anthropics/claude-code#49063](https://github.com/anthropics/claude-code/issues/49063)), so
  the deep-dive nudge silently no-ops there. The spawn-brief rewrite and SessionStart injection
  are unaffected.

**Retire it from your global config.** If you'd previously hand-rolled any of this — a routing/
execution-decision/subagent-strategy block in `~/.claude/CLAUDE.md`, or a `UserPromptSubmit`
hook in `~/.claude/settings.json` that echoes a static promper reminder on every turn — remove
it once this plugin is installed. `inject-contract.mjs` covers the standing rules, and
`gate-prompt.mjs` is the same nudge but gated on an actual new task instead of firing on every
single prompt.

## Install / use

Quickest path, one command:

```
npx @ninjamin/promper
```

That copies the `promper`, `promper-setup`, `prim`, `breakdown`, and `singularity` skills into `~/.claude/skills/` **and
bootstraps the role source** — promper has a hard dependency on the
[wshobson/agents](https://github.com/wshobson/agents) plugin marketplace (88 plugins,
~194 agents). The installer adds it via `claude plugin marketplace add wshobson/agents` when
missing, then scans it into the map. Restart Claude Code and the five skills resolve.

Re-run the bootstrap any time (idempotent; also what `/promper:setup` runs):

```
npx @ninjamin/promper bootstrap
```

To add supplementary local agents to the map (deterministic scan, no model tokens):

```
npx @ninjamin/promper scan
```

`promper scan` reads agent frontmatter from `~/.claude/agents`, `./.claude/agents`,
`~/.codex/agents`, and `~/.gemini/agents`, classifies by name table + description keywords,
and writes the lean pieces to `~/.invoker/map/` (tiny `index.json` + one small file per
domain — routing never reads a large file). Idempotent: existing assignments are never
moved, and re-scanning with a narrower flag set never drops an entry whose source file still
exists — only a genuinely-vanished file gets dropped. Flags: `--check` (dry run) ·
`--dir <path>` (extra dirs) · `--plugins <root>` (a wshobson-style marketplace:
`<root>/plugins/<plugin>/agents/*.md`) · `--categories <root>` (a category-flat agent repo:
`<root>/<category>/*.md`, no nested `agents/` folder — e.g.
[awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents),
[agency-agents](https://github.com/msitarzewski/agency-agents)) · `--no-defaults` ·
`--out <path>`. Every
`--plugins`/`--categories` root also feeds `~/.invoker/map/toolkits.json` — each plugin's
skills/commands indexed once, by description, for the routing suggestions in Step 5 of
`skills/promper/SKILL.md`.

`--plugins` only scans plugins the user has actually installed from that marketplace, per
Claude Code's own `~/.claude/plugins/installed_plugins.json` — a marketplace checkout carries
every plugin it publishes, not just the ones enabled locally, so scanning all of them would
map agents you can't invoke. Uninstalling a plugin drops its agents from the map on the next
scan even though the marketplace checkout still has the files on disk. Falls back to
unfiltered scanning when that file is missing or unreadable (non-Claude-Code environments,
hand-rolled `--plugins` roots).

**Plugin marketplaces as the role source:** point the scanner at a marketplace checkout —
e.g. [wshobson/agents](https://github.com/wshobson/agents) (88 plugins, ~194 agents, each
plugin bundling `agents/ + skills/ + commands/`):

```
promper scan --plugins ~/Documents/GitHub/wshobson-agents --no-defaults
```

Map entries record each agent's owning plugin; when promper inherits a role it also inherits
the plugin's toolkit — the engineered prompt (or spawned brief) names the plugin's skills and
commands so the role arrives with its equipment, not just its persona.

No plugin installation required — installed plugins cost ambient context in every session,
so promper *hydrates* instead:

```
promper hydrate fastapi-pro "Build a secure OAuth2 routing system with JWT verification."
```

`hydrate` resolves the agent through the map (exact name or file stem — `fastapi-pro` finds
`api-scaffolding-fastapi-pro`), falls back to a recursive marketplace walk, keeps the agent's
frontmatter (name/description/model context travels with the role), folds in the plugin's
toolkit, and emits one spawn-ready prompt. Flags:
`--json` (structured output for programmatic spawning) · `--template <path>` (custom
role template with `{{TARGET_ROLE_PROFILE}}`/`{{USER_TASK}}`/`{{TOOLKIT_BLOCK}}` slots) ·
`--map <dir>`.

These same two deterministic building blocks power the hooks described in
[Active mode](#active-mode) below: `promper brief "<task>" [--agent <name>] [--subagent-type
<type>] [--json]` applies the role-bearing precedence (named agent → hydrate → unrouted) that
`enrich-spawn.mjs` calls directly (in-process, no subprocess), and
`promper gate "<prompt>" [--transcript <path>] [--json]` is the deep-dive-vs-follow-up
classifier `gate-prompt.mjs` uses the same way. Both are also plain CLI commands — useful
standalone for debugging what a hook would do, without needing a live spawn.

`promper classify "<text>" [--json] [--map <dir>] [--top <n>]` is the task-text → domain
breakdown primitive behind `/promper:breakdown`: it runs the registry trigger tables over the
text (word-boundary, priority-ranked — the same `collectMatches` the scanner uses on agent
descriptions), groups the hits by domain, and flags which suggested agents exist in the lean
map. Deterministic: same text + same map → same output; no match exits 0 with
`"unmapped": true`.

**Local dev:** the nine skill directories can be symlinked into `~/.claude/skills/`, so the commands resolve directly while you work on them (restart Claude Code to pick up new commands). The repo stays the single source of truth, so there is no second copy to drift.

> promper routes itself: it picks the role-source agent from the in-session agent list when
> visible, else from the lean map pieces at `~/.invoker/map/` (built by `/promper:setup`). No
> list and no map → generic expert role plus a setup suggestion.

## License

Apache-2.0
