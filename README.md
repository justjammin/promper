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
    additional-context.mjs   deterministic decision-gate hook (see below)
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

## The decision gate

Earlier invokerai builds tried this with shell hooks: escaped-JSON `echo` strings in `settings.json` and a bash token gate with a 30-second TTL. The intent was right; the mechanics weren't (quoting bugs, a deny that exited 1 so it never actually denied, a token race, and nudges toward MCP tools that no longer exist).

promper ships the real version: [`hooks/additional-context.mjs`](hooks/additional-context.mjs), a single deterministic Node file.

```
npx @ninjamin/promper --hook
```

The stance: **every question and coding decision gets proper prompt engineering.** Three events, one file:

- **`UserPromptSubmit`** — injects the mandate on *every* prompt: apply `pe-principles.md` (objective, structure, constraints, output format, stated assumptions) before answering or deciding.
- **`SessionStart`** — the mandate plus the routing digest: agent-map domains/counts and prim seal status (skipped on resume).
- **`PreToolUse` on `Agent`/`Task` — the hard gate.** Raw spawns are **denied** unless a spawn grant exists. Grants are minted by the `/promper` flow itself, immediately before spawning — so the only path to a subagent runs through routing + role inheritance + an engineered brief. The deny reason tells the model exactly how to comply.

Grant mechanics (what makes it deterministic where the old gate wasn't):

- Grants are one-shot files in `~/.promper/grants/`, consumed by atomic `unlink` — no TTL clock, no read-modify-write race, and N parallel spawns consume exactly N grants.
- `node ~/.claude/hooks/promper-additional-context.mjs --grant <n>` mints, `--revoke` clears, `--status` shows mode + outstanding grants.
- Denies exit 0 with proper `hookSpecificOutput` JSON, which is the only form Claude Code enforces.
- Output is a pure function of (event, agent map, prim ledger, grants, config) — byte-identical given the same inputs.

Dial it down without uninstalling via `~/.promper/config.json`: `{"gate": "hard"}` (default), `"advisory"` (context only, no denies), or `"off"`.

This is a workflow gate, not a security boundary — it forces the engineering step into the loop; it doesn't defend against something determined to bypass it.

Installing via the Claude Code plugin gets the gate automatically (`hooks/hooks.json` uses `${CLAUDE_PLUGIN_ROOT}`). To uninstall the npx version, remove the three entries referencing `promper-additional-context.mjs` from `~/.claude/settings.json` and delete `~/.claude/hooks/promper-additional-context.mjs`.

## License

Apache-2.0
