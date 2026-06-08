# promper

A prompt-engineering toolkit for Claude Code. Two commands:

- **`/promper <intent>`** — engineers a clean, **role-grounded** prompt from a rough request.
- **`/prim`** — certifies your agents against the prompt-engineering standard ("seal of approval").

## The idea

invokerai routes every task — solo or multi-domain — to the proper specialist agent. Those
agents *are* prompt engineering: each one's system prompt is a tuned persona for its domain. So
the right `<role>` for a prompt is the agent invokerai would pick — not a guessed "you are an
expert…".

```
raw intent
  → invokerai decompose + spawn   →  selects the proper agent(s)
        → agent persona            ⇒  <role>   (inherited, not invented)
  → Prompt Engineer agent fills the rest around that role
        <context> <instructions> <examples> <constraints> <output_format>
  → engineered prompt(s)
```

**Division of labor:** promper *makes* · invokerai *routes* · the agents *are* the roles · prim
*guards* (certifies the agents the roles come from).

## /promper

```
/promper write a tweet announcing my budgeting app
```

- **Portable (default):** returns a standalone, copy-paste prompt with the persona inlined.
- **`--run`:** engineers, then spawns the selected agent(s) and executes (invokerai + a prompt-polish pass).
- `--agent=<name>` override · `--target=portable|costar` · `--deep` (hand the whole job to the Prompt Engineer agent).

Default skeleton is Claude-native XML; `--target=costar` emits CO-STAR for portable/non-Claude prompts.

## /prim

```
/prim                # pick agents to evaluate
/prim --all          # evaluate all (still confirms once)
/prim my-writer --fix
```

Scores each approved agent 0–100 against the rubric, lists P0/P1/P2 findings with fixes, and
records a seal (`score ≥ 80 AND zero P0`) to `~/.claude/agents/.prim-seal.json`. `--fix` rewrites
failing agents — gated with per-file diffs and confirmation, and it never silently edits
plugin-provided agents (those revert on `/plugin update`; it offers an override copy instead).

promper reads the prim ledger and warns when it's about to inherit a role from an uncertified or
weak agent.

## Layout

```
promper/
  .claude-plugin/      plugin.json + marketplace.json
  skills/
    promper/SKILL.md   the "make" skill
    prim/SKILL.md      the "evaluate / certify" skill
  reference/
    pe-principles.md   shared source of truth (11 principles, XML skeleton, rubric)
```

## Install / use

For immediate local use, the two skills are symlinked into `~/.claude/skills/` so `/promper` and
`/prim` resolve directly (restart Claude Code to register new commands). The repo is the single
source of truth — the symlinks point back at `skills/promper` and `skills/prim`, so there is no
second copy to drift.

> Requires **invokerai** installed (`~/.claude/skills/invokerai/`) with a built agent map at
> `~/.invoker/agent-map.json`. The `<role>` inheritance depends on it.

> **Note:** `promper` is permitted to invoke invokerai (an explicit exception to the usual "skills
> don't call invokerai" rule), because driving invokerai's routing to inherit roles is its core function.

## License

Apache-2.0
