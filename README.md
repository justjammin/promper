<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/promper-stacked-light.svg">
    <img alt="Promper — prim & proper prompts all the time" src="assets/promper-stacked.svg" width="300">
  </picture>
</p>

# promper

Promper is a prompt-engineering toolkit for Claude Code. It ships two commands:

- **`/promper <intent>`**: turns a rough request into a clean, **role-grounded** prompt.
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

**Who does what:** promper *makes* the prompt, *routes* to the agent, and *decides execution* · the agents *are* the roles · prim *guards* them · invokerai (optional) remains for standalone BEADS-tracked orchestration.

## /promper

```
/promper write a tweet announcing my budgeting app
```

- **Portable (default):** you get a standalone, copy-paste prompt with the persona baked in. Take it anywhere.
- **`--run`:** promper engineers the prompt(s), presents the plan, then executes — each node runs inline or as a spawned subagent based on a per-node token decision.
- Flags: `--agent=<name>` to override the pick · `--target=portable|costar` · `--deep` to spawn the Prompt Engineer agent for heavy drafting (default crafting is inline).

The default skeleton is Claude-native XML. Pass `--target=costar` to emit CO-STAR for portable or non-Claude prompts.

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
  .claude-plugin/      plugin.json + marketplace.json
  skills/
    promper/SKILL.md   the "make" skill
    promper-setup/SKILL.md   builds the lean routing map (wraps `promper scan`)
    prim/SKILL.md      the "evaluate / certify" skill
  src/                 the TypeScript scanner (`promper scan`) — deterministic, zero LLM
  reference/
    pe-principles.md   shared source of truth (11 principles, XML skeleton, rubric)
```

## Install / use

Quickest path, one command:

```
npx @ninjamin/promper
```

That copies the `promper`, `promper-setup`, and `prim` skills into `~/.claude/skills/`. Restart Claude Code and `/promper` and `/prim` resolve.

Then build the routing map (deterministic scan, no model tokens):

```
npx @ninjamin/promper scan
```

`promper scan` reads agent frontmatter from `~/.claude/agents`, `./.claude/agents`,
`~/.codex/agents`, and `~/.gemini/agents`, classifies by name table + description keywords,
and writes the lean pieces to `~/.invoker/map/` (tiny `index.json` + one small file per
domain — routing never reads a large file). Idempotent: existing assignments are never
moved. Flags: `--check` (dry run) · `--dir <path>` (extra dirs) · `--legacy` (also refresh
an old invokerai `agent-map.json`) · `--out <path>`.

**Positioning:** promper is built for frontier harnesses (Claude Code and friends). For
custom harnesses — LangGraph, Flowise, bespoke agent loops — use
[invoker](https://github.com/justjammin/invokerai) as an SDK routing node; it consumes the
same `~/.invoker/map/` artifact and shares the bead_graph node shape and bead ticket
lifecycle.

**Local dev:** the two skills are symlinked into `~/.claude/skills/`, so the commands resolve directly while you hack on them (restart Claude Code to pick up new commands). The repo stays the single source of truth: the symlinks point back at `skills/promper` and `skills/prim`, so there's no second copy to drift.

> **invokerai is optional.** promper routes itself: it picks the role-source agent from the
> in-session agent list when visible, else from the lean map pieces at `~/.invoker/map/`
> (built by `/promper:setup`, or converted one-shot from a legacy invokerai
> `agent-map.json`). No list and no map → generic expert role plus a setup suggestion.
> promper's internal node shape ({id, domain, action, deps, parallel, agent}) matches
> invokerai's bead_graph, so a promper plan still hands off cleanly to `/invokerai:spawn`
> if you want full BEADS-tracked orchestration.

## License

Apache-2.0
