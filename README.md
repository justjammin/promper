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
    prim/SKILL.md      the "evaluate / certify" skill
  hooks/
    additional-context.mjs   deterministic advisory hook (see below)
    hooks.json               plugin-install hook registration
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

## The additionalContext hook (optional)

Earlier invokerai builds injected routing context with shell hooks: escaped-JSON `echo` strings in `settings.json` and a bash script that hard-denied raw `Agent` calls. Those were fragile (quoting), coercive (`permissionDecision: deny`), fired on every prompt, and now point at MCP tools that no longer exist.

promper ships the palatable replacement: [`hooks/additional-context.mjs`](hooks/additional-context.mjs), a single deterministic Node file.

```
npx @ninjamin/promper --hook
```

What it does, and deliberately does not do:

- **Deterministic.** Pure function of the hook event + `~/.invoker/agent-map.json` + the prim ledger. Same inputs → byte-identical output. No timestamps, no shell quoting, output built with `JSON.stringify`.
- **Advisory only.** Emits `additionalContext` — a compact digest of the agent map (domains, counts) and prim seal status. It never emits `permissionDecision` and never blocks a tool call.
- **Quiet.** `SessionStart` injects the digest once per session (skipped on resume). `UserPromptSubmit` injects only when the prompt is actually about routing or prompt engineering; every other turn produces zero output.
- **Fails open.** Missing agent map, corrupt JSON, or unexpected stdin → exit 0, no output (a missing map yields a one-line pointer to `/invokerai:setup`).

Installing via the Claude Code plugin gets the hook automatically (`hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}`). To uninstall the npx version, remove the two entries referencing `promper-additional-context.mjs` from `~/.claude/settings.json` and delete `~/.claude/hooks/promper-additional-context.mjs`.

## License

Apache-2.0
