# Migrating off the legacy global invoker/promper config

promper's own hooks (`hooks/hooks.json`, shipped with the plugin — see `docs/plugin-flow.md`)
now cover what used to be hand-maintained in a personal `~/.claude/settings.json` and
`~/.claude/CLAUDE.md`. This doc records exactly what was removed on the first device this was
done on, and the steps to repeat it on any other device.

## What gets removed, and why

### 1. `~/.claude/settings.json` — the static `UserPromptSubmit` echo hook

**Before** (one entry in the `UserPromptSubmit` array):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"Promper flow for non-trivial tasks: decompose inline, walk map pieces (~/.invoker/map/), inherit roles, engineer prompts. Per node: run inline when light, spawn agents when noisy/parallel/isolated — spawn on judgment, not only when told. Present a plan before large executions.\"}}'"
    }
  ]
}
```

**Why remove it:** this fires on **every single prompt**, unconditionally — no gating. The
plugin's own `hooks/gate-prompt.mjs` (`UserPromptSubmit`) injects the same category of nudge,
but only on an actual deep-dive turn (a session opener or a new substantial task); it stays
silent on an ordinary follow-up. Keeping both means the nudge fires twice, redundantly, on
every turn forever.

**What stays:** the *other* entry in that same array (the `~/.pixel-agents/hooks/claude-hook.js`
call, `matcher: ""`) — unrelated third-party tooling, not part of this migration.

### 2. `~/.claude/CLAUDE.md` — two blocks

**Block A** — `### 2. Subagent Strategy`, under `## Workflow Orchestration`:

```markdown
### 2. Subagent Strategy
- **Framework:** promper routing — see Agent Routing section below.
- Per-node execution decision: inline when light, subagents when noisy/parallel/isolated.
- Offload research, exploration, parallel analysis to subagents.
- One focused task per subagent.
```

**Block B** — the whole `## Agent Routing — promper` section, under
`## Subagents, Coding and Research` (it was wrapped in its own marker comments,
`<!-- INVOKERAI-START -->` / `<!-- INVOKERAI-END -->`):

```markdown
<!-- INVOKERAI-START -->
## Agent Routing — promper

Routing, decompose, and role-inheritance: `/promper` (lean map pieces at `~/.invoker/map/`, built by `/promper:setup`; never read any map file whole). Per-node execution decision: inline when light (<~5K tok expected tool noise), spawn agents when noisy, parallel, or isolation warranted — spawn on judgment, not only on explicit request. invokerai skills remain installed for standalone BEADS-tracked orchestration.

Before direct edits inside the active repo, record the analysis at `~/.invoker/state/promper-decision.json`: `{"verdict":"inline"|"agent","repo":"<repo root>","reason":"<one line>","ts":<epoch ms>}`. The edit gate enforces this — verdict `inline` unlocks direct edits (60-min TTL); verdict `agent` means spawn the selected specialist.
<!-- INVOKERAI-END -->
```

**Why remove both:** this is the exact routing + execution-decision + edit-gate contract that
`hooks/inject-contract.mjs` now injects automatically every session, from `hooks/contract.md`
inside the plugin. Keeping the personal-file copy means two sources of truth that will drift
the moment one gets edited and the other doesn't.

**What replaced Block B**, in place, under the same `## Subagents, Coding and Research` header:

```markdown
promper's routing/execution-decision rules are now injected automatically by its own
SessionStart hook (`hooks/contract.md` in the promper plugin) — no longer maintained here.
See `docs/migrating-legacy-global-config.md` in the promper repo.
```

**Numbering note:** removing Block A leaves the `## Workflow Orchestration` list reading
`1, 3, 4, 4a, 5, 6` — deliberately not renumbered. These are prose headers read by a model, not
code; renumbering the rest of the file was out of scope for this migration and risked touching
unrelated content.

## What does NOT get touched, and why

`~/.claude/settings.json` also has two other hooks that reference the invoker/promper machinery
and were **left alone**:

- `PreToolUse` (matcher `Edit|Write|MultiEdit|NotebookEdit|Task|Agent`) →
  `~/.claude/hooks/invoker-gate.js`
- `SubagentStart` / `PostToolUse` (matcher `Task|Agent|Skill`) → `~/.claude/hooks/invoker-mark.js`

These implement the **edit-gate enforcement** itself (reading `promper-decision.json` and
actually blocking/allowing edits) — promper's shipped plugin hooks don't yet replace this; they
only cover routing (the SessionStart contract + the deep-dive nudge) and the spawn-brief
rewrite. Removing `invoker-gate.js`/`invoker-mark.js` would break real enforcement, not just
retire a redundant reminder. Leave them in place until/unless promper ships its own gate
enforcement hook.

## Steps to repeat this on another device

1. Confirm the promper plugin is installed and its hooks are registered — restart Claude Code,
   then ask "did you get session-start context about a promper orchestration contract?" A yes
   confirms `hooks/inject-contract.mjs` is live before you remove anything.
2. Open `~/.claude/settings.json`. Find the `UserPromptSubmit` array. Delete the entry whose
   `command` is the `echo '{"hookSpecificOutput":...,"additionalContext":"Promper flow for
   non-trivial tasks..."}'` line (Section 1 above). Leave every other entry in that array
   untouched. Validate the file still parses (`node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/settings.json'))"`).
3. Open `~/.claude/CLAUDE.md`. Remove Block A and Block B verbatim as shown above (search for
   the literal heading text — `### 2. Subagent Strategy` and `<!-- INVOKERAI-START -->` — since
   line numbers will differ per device).
4. Do **not** touch `invoker-gate.js` / `invoker-mark.js` registrations, or any other hook
   entries unrelated to the two blocks above.
5. Re-verify: fresh session, ask the same session-start question as step 1, then give a
   deep-dive prompt and a follow-up prompt in the same session to confirm the gate fires once
   and stays silent on the follow-up (same live-test method used in `plugin-flow.md`).

These two files (`~/.claude/settings.json`, `~/.claude/CLAUDE.md`) live outside any git repo, so
there's no repo-level undo if an edit goes wrong — this doc's verbatim "before" blocks above are
the recovery record. Copy them back in by hand if you need to revert.
