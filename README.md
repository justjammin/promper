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

Part of prompt engineering is the role but what's the best role for the job? I made [invokerai](https://github.com/justjammin/invokerai) for figuring that part out. But you still need the other 10 steps for a good prompt. So the best `<role>` for your prompt isn't something you guess ("you are an expert…"). It's the agent invokerai would have picked anyway. promper just borrows it.

```
raw intent
  → invokerai decompose + spawn   →  selects the proper agent(s)
        → agent persona            ⇒  <role>   (inherited, not invented)
  → Prompt Engineer agent fills the rest around that role
        <context> <instructions> <examples> <constraints> <output_format>
  → engineered prompt(s)
```

**Who does what:** promper *makes* the prompt · invokerai *routes* to the agent · the agents *are* the roles · prim *guards* them (it certifies the agents those roles come from).

## /promper

```
/promper write a tweet announcing my budgeting app
```

- **Portable (default):** you get a standalone, copy-paste prompt with the persona baked in. Take it anywhere.
- **`--run`:** promper engineers the prompt, then spawns the selected agent(s) and runs it (invokerai plus a prompt-polish pass).
- Flags: `--agent=<name>` to override the pick · `--target=portable|costar` · `--deep` to hand the whole job to the Prompt Engineer agent.

The default skeleton is Claude-native XML. Pass `--target=costar` to emit CO-STAR for portable or non-Claude prompts.

## Setup runner (auto-route every prompt through `--run`)

`promper-setup-runner` installs a Claude Code **`UserPromptSubmit` hook** so you don't have to
type `/promper … --run` each time — every bare prompt is routed through promper's run flow, and
any **invokerai prompt-submit hook is replaced** so promper owns the routing.

```
npx @ninjamin/promper                 # install the skills first
promper-setup-runner                  # wire the hook into ~/.claude/settings.json
promper-setup-runner --project        # ...or into ./.claude/settings.json (this repo only)
promper-setup-runner --keep-invoker   # install alongside invokerai's hook instead of replacing it
promper-setup-runner --uninstall      # remove promper's hook
```

### How the hook routes (one dispatcher, many passes)

On each submission the prompt arrives on the hook's stdin. The hook (`hooks/prompt-submit.mjs`) is a
**dispatcher**: it detects which AI tool the prompt came from and routes to that tool's pass, emitting
output *of the same nature* as that source.

```
prompt on stdin
  → detect source  (PROMPER_SOURCE env → Claude hook signature → tool dir in cwd → default)
  → Claude          → ADD CONTEXT   (additionalContext steering into /promper … --run)
  → .codex/.cursor… → REWRITE        (replace the prompt with the engineered run directive)
  → unknown         → default rewrite
```

Why two kinds of pass: a Claude Code `UserPromptSubmit` hook can only *add context*, so the Claude
pass injects an `additionalContext` directive (decompose via invokerai, inherit the role, engineer,
run). Tools like Codex and Cursor consume a prompt directly, so their passes **rewrite** the prompt
into a self-contained engineered run directive (the promper skill may not be installed there).

Layout — add a tool by dropping in one file:

```
hooks/
  prompt-submit.mjs   dispatcher: detect source, route, emit in that source's shape
  lib/route.mjs       shared promper logic (skip rules, context directive, rewrite directive)
  sources/claude.mjs  additive-context pass
  sources/codex.mjs   direct-rewrite pass
  sources/cursor.mjs  direct-rewrite pass
  sources/default.mjs generic direct-rewrite pass
```

Every pass honors the same skip rules — a prompt passes through untouched (Claude: no context;
rewrite tools: echoed unchanged) when it's already a `/slash-command`, is empty, or carries the
`--raw` opt-out. The dispatcher never blocks a submission: any failure exits 0. Source detection can
be forced with `PROMPER_SOURCE=<name>`. The setup runner copies the whole `hooks/` tree to
`~/.claude/promper/hooks/`, backs up your settings, and is idempotent.

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
  bin/
    promper.mjs        installer: copies the skills into ~/.claude/skills/
    setup-runner.mjs   installer: wires the prompt-submit hook (auto --run)
  hooks/
    prompt-submit.mjs  dispatcher: routes the prompt to a per-source pass
    lib/route.mjs      shared routing logic (skip rules + directives)
    sources/           per-tool passes (claude, codex, cursor, default)
  skills/
    promper/SKILL.md   the "make" skill
    prim/SKILL.md      the "evaluate / certify" skill
  reference/
    pe-principles.md   shared source of truth (11 principles, XML skeleton, rubric)
```

## Install / use

Quickest path, one command:

```
npx @ninjamin/promper
```

That copies the `promper` and `prim` skills into `~/.claude/skills/`. Restart Claude Code and `/promper` and `/prim` resolve.

**Local dev:** the two skills are symlinked into `~/.claude/skills/`, so the commands resolve directly while you hack on them (restart Claude Code to pick up new commands). The repo stays the single source of truth: the symlinks point back at `skills/promper` and `skills/prim`, so there's no second copy to drift.

> Needs [invokerai](https://github.com/justjammin/invokerai) installed (`~/.claude/skills/invokerai/`) with a built agent map at `~/.invoker/agent-map.json`. The `<role>` inheritance depends on it.

> **Heads up:** promper is allowed to call [invokerai](https://github.com/justjammin/invokerai) directly. That's a deliberate exception to the usual "skills don't call invokerai" rule, because driving invokerai's routing to inherit roles is the whole point.

## License

Apache-2.0
