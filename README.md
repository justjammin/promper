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

How it works: on each submission Claude Code hands the hook the prompt on stdin. The hook
(`hooks/prompt-submit.mjs`, copied to `~/.claude/promper/`) injects an `additionalContext`
directive telling Claude to treat the message as a raw intent and run `/promper <intent> --run`
— decompose via invokerai, inherit the proper agent's role, engineer the prompt, then spawn that
agent and execute. The `--run` flag is injected for you.

The hook passes a prompt through untouched when routing would loop or isn't wanted: it's already
a `/slash-command`, it's empty, or it carries the `--raw` opt-out marker. Each install backs up
the existing settings file and is idempotent (re-running won't duplicate the hook).

> A `UserPromptSubmit` hook can add context or block — it can't literally rewrite your message
> into another command. So the runner steers the model toward the `--run` flow via injected
> context rather than substituting the command outright.

## Stdio runner (rewrite the prompt, then run it)

When you want to **actually rewrite the prompt** before it reaches the model — not just inject
context — use `promper-run`. It's a standalone wrapper that owns the whole pipeline and calls the
Anthropic API directly:

```
raw intent (stdin / argv)
  → route via invokerai (~/.invoker/agent-map.json) → inherit the proper agent's role
  → engineer the prompt body around that role          (pass 1: Prompt Engineer model call)
  → REWRITE the prompt that goes downstream
  → run the engineered prompt against the model        (pass 2: the injected --run pass)
→ result (stdout)
```

```
promper-run "write a tweet announcing my budgeting app"   # engineer + run, result to stdout
echo "write a tweet ..." | promper-run                    # reads intent from stdin
promper-run --prompt-only "..."     # emit the rewritten prompt and stop (pure stdio rewrite)
promper-run --dry-run "..."         # routing + skeleton scaffold, no API call
promper-run --agent=content-marketer "..."   # force the role source
promper-run --target=costar "..."   # CO-STAR skeleton instead of Claude-native XML
promper-run --model=claude-opus-4-8 --effort=high "..."
```

Routing is deterministic (best-match of the intent against each agent's description in the invokerai
agent map); the role is inherited from the picked agent and used as the model's system prompt for the
run. The routing header and progress go to **stderr**, so **stdout** stays a clean prompt/result pipe
you can redirect or chain. Needs `ANTHROPIC_API_KEY` in the environment; `--dry-run` needs no key.

This is the true "edit the stdio" path — distinct from the hook above, which can only add context. A
`UserPromptSubmit` hook can't substitute the prompt; this runner can, because it sits in front of the
model call instead of inside Claude Code's hook system.

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
    setup-runner.mjs   installer: wires the UserPromptSubmit hook (auto --run)
    run.mjs            stdio runner: rewrite the prompt + run it via the API
  hooks/
    prompt-submit.mjs  the UserPromptSubmit hook that injects /promper … --run
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
