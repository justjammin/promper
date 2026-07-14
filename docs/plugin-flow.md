# How promper moves — current state

Two independent paths through the plugin: **manual** (you type `/promper`) and **active**
(five hooks that fire on their own). This doc is the plain-English map of both, as they
actually behave right now — not the aspirational design, the verified one.

## Manual path

```
you: /promper <rough intent>
  → skills/promper/SKILL.md runs, entirely inline, in the main model
  → decompose intent → route via ~/.invoker/map/ → inherit persona → craft prompt
  → present prompt(s) + routing header. Zero spawns.
  → (only on --run) spawn per the Step 7.5 inline-vs-subagent decision
```

Nothing here is a hook. This is the same as it's always been — a skill the model follows when
you invoke it.

## Active path — five hooks, one state file

```mermaid
sequenceDiagram
    participant User
    participant Claude as Main model
    participant SS as SessionStart hook<br/>(inject-contract.mjs)
    participant UPS as UserPromptSubmit hook<br/>(gate-prompt.mjs)
    participant State as ~/.invoker/state/<br/>promper-decision-&lt;session_id&gt;.json
    participant Gate as PreToolUse hook<br/>(contract-gate.mjs)
    participant PTU as PreToolUse hook<br/>(enrich-spawn.mjs)
    participant Sub as Spawned subagent
    participant SE as SessionEnd hook<br/>(clear-decision.mjs)

    Note over SS: fires once, every session start
    SS->>Claude: inject contract.md (routing rules, edit gate, off switch)

    User->>Claude: types a prompt
    Claude->>UPS: prompt + transcript_path
    UPS->>UPS: promper gate (deterministic, no LLM):<br/>turn 0 → deep · back-reference/short → follow-up<br/>else → deep
    alt deep
        UPS->>Claude: inject nudge + re-inject contract.md
        Claude->>Claude: runs skills/promper/SKILL.md inline<br/>(decompose → route → inherit persona)
        Claude->>State: write {verdict, repo, agent, reason, ts}
    else follow-up
        UPS-->>Claude: (nothing — silent)
    end

    Claude->>Gate: Edit/Write on a repo file, intercepted first
    Gate->>State: read decision
    alt fresh, same-repo decision (any verdict)
        Gate-->>Claude: allow — edit proceeds
    else missing / stale / other repo
        Gate->>Claude: deny + contract summary + exact JSON to record
        Claude->>State: write decision (ungated — outside the repo)
        Claude->>Gate: retry edit → allow
    end

    Claude->>Sub: Agent/Task tool call (subagent_type, prompt)
    Claude->>PTU: same call, intercepted first
    PTU->>PTU: promper brief (deterministic, no LLM):<br/>named agent + toolkit found → row 1<br/>general-purpose + State has fresh match → row 2<br/>neither → row 3
    alt row 1 or row 2 (real value to add)
        PTU->>Sub: updatedInput.prompt = role-bearing brief
    else row 3 (nothing to add)
        PTU-->>Sub: unchanged — original brief passes through
    end
    Sub->>Claude: result

    Note over SE: fires at session end
    SE->>State: clear decision (same-repo only) — gate re-arms next session
```

## What "deterministic, no LLM" means here, concretely

Both `gate-prompt.mjs` and `enrich-spawn.mjs` call plain TypeScript functions
(`classifyGate`/`countPriorUserTurns` and `buildBrief`) — regex checks, JSON reads, file-system
lookups. Neither hook can call a model even if it wanted to (hooks are shell commands, not LLM
calls) — the *only* LLM-requiring step is the agent-walk itself (routing, persona selection),
which runs in the main model when the gate nudges it, or when you run `/promper` by hand. The
hooks are the deterministic scaffolding around that one LLM step, not a replacement for it.

## The contract gate — why injection alone wasn't enough

`inject-contract.mjs` puts the contract into context, but context is advisory: as a session
grows (or gets summarized), the model can drift and edit without ever running the agent-walk.
`contract-gate.mjs` closes that hole at the only chokepoint that can't be ignored — the tool
call itself. Design properties, all deliberate:

- **Repo-scoped, deadlock-free.** Only writes to files inside the active repo root are gated.
  The state file lives at `~/.invoker/state/` — outside every repo — so recording the decision
  (the very thing the denial asks for) always passes.
- **Any fresh verdict satisfies it.** Hooks fire inside subagents too, and a subagent's edit is
  indistinguishable from the main model's, so denying `verdict:"agent"` edits would lock out
  the routed specialist doing the work. The gate therefore enforces "the analysis happened",
  not "who is allowed to type" — presence + freshness + repo match, nothing more.
- **The denial teaches.** The deny reason re-delivers the contract summary plus the literal
  JSON to write, at the moment of highest attention. No hunting through session-start context.
- **Fails open.** Unparseable input, missing fields, unreadable state — every unexpected path
  allows the edit. A broken gate degrades to "no gate", never to "no editing".
- **Re-arms per session.** `clear-decision.mjs` (SessionEnd) removes this repo's decision so a
  decision written at 5:59 of a session doesn't let the next session's first edit skip the
  walk. Decisions are session-scoped (`promper-decision-<session_id>.json`), so a session
  ending never wipes another live session's decision — same repo or not; it removes only its
  own file, then sweeps any session files older than the TTL. (SessionEnd, not Stop: Stop
  fires after every turn, which would force a re-walk per turn and starve row 2 of the spawn
  hook.) Only when the payload carries no session_id does the legacy global
  `promper-decision.json` apply, with the old repo-scoped delete rule.

## The hand-off, and why it can silently no-op

`~/.invoker/state/promper-decision-<session_id>.json` (the hooks substitute the concrete
session path into the injected contract; the legacy global `promper-decision.json` is the
permanent fallback for environments without a session_id, e.g. Codex) is the only channel
between the gate (which triggers routing) and the spawn hook (which inherits the result). Two
things make this brittle by design, not by accident:

- **60-minute TTL.** A stale decision is treated as absent, not as a wrong-but-present answer.
- **Exact repo match** (`git rev-parse --show-toplevel`, both sides). Spawn a subagent from a
  different repo than the one that wrote the decision → row 3, not a wrong persona.

Both failure modes degrade to row 3 (skeleton, or — since the noop fix — a complete no-op),
never to a wrong or invented role. That's the same "never invent a role" rule the manual path
follows, just enforced by a TTL and a path comparison instead of the model's own judgment.

## The off switch

`PROMPER_ACTIVE=0` is checked first thing in all five hook scripts — before reading stdin, before
touching the state file. Set it and every hook becomes a pure pass-through. `/promper`, `/prim`,
and `/promper:setup` don't check this variable at all — they're unaffected either way.

## What's real vs. what's still a gap

| Piece | Status |
|---|---|
| SessionStart injects the contract | ✅ verified live (`claude -p --plugin-dir`) |
| Gate fires on session opener, stays silent on a same-session follow-up | ✅ verified live, including a real `--resume` multi-turn test |
| Spawn hook rewrites row 1 (toolkit) / row 2 (persona) | ✅ verified live, including the node_modules-free deployment bug fix |
| Spawn hook leaves row 3 (nothing to add) untouched | ✅ verified live |
| Contract gate denies repo edits without a fresh decision; passes fresh/out-of-repo/off-switch/garbage-input | ✅ verified with piped hook JSON (all six paths); ⚠️ not yet verified in a live session |
| SessionEnd clear: same-repo cleared, other-repo kept, corrupt cleared | ✅ verified with piped hook JSON; ⚠️ not yet verified in a live session |
| Gate re-injects contract.md on deep prompts | ✅ verified with piped hook JSON |
| Row 2 producing a measurably better output than an unrouted spawn | ✅ one A/B trial — see `spawn-ab-test-cost-and-output.md`; not yet a repeated/controlled study |
| Codex (`.codex-plugin/plugin.json` + same hooks) | ⚠️ files ship, hook *behavior* on a real Codex install is unverified |
| `UserPromptSubmit` nudge in the VSCode extension | ⚠️ known-broken upstream (`additionalContext` is CLI-only per anthropics/claude-code#49063) — SessionStart and the spawn hook are unaffected |
