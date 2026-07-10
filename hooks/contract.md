promper orchestration contract — injected automatically at session start so this behavior
doesn't need to live in your personal ~/.claude/CLAUDE.md. Full routing logic:
skills/promper/SKILL.md. Principles: reference/pe-principles.md. This is the standing summary.

ROUTING: for any non-trivial task, decompose inline into nodes ({id, domain, action, deps,
parallel}). Route each node to a specialist agent by walking the lean map
(~/.invoker/map/index.json -> the matching <domain>.json) — never read a map file whole. Inherit
that agent's persona as the node's role; never invent one. `/promper` runs this manually,
plan-first, zero spawns. The UserPromptSubmit hook nudges it automatically on a new substantial
task (not on a follow-up to a previous question).

EXECUTION DECISION (per node): light work (roughly under 5K tokens of expected tool noise, no
parallelism) runs inline in the main context. Noisy, parallel-safe, or isolation-sensitive work
spawns the routed specialist as a subagent. Spawn on judgment, not only when explicitly asked.

ROUTING HAND-OFF + EDIT GATE: before direct edits in the active repo, or after routing a node,
record the decision at ~/.invoker/state/promper-decision.json:
{"verdict":"inline"|"agent"|"mixed","repo":"<repo root>","agent":"<routed agent name, if any>","reason":"<one line>","ts":<epoch ms>}
The edit gate enforces it — verdict inline/mixed unlocks direct edits in the repo (60-min TTL);
verdict agent means the work goes to the spawned specialist. When `agent` is recorded, promper's
PreToolUse spawn hook inherits that exact role automatically on the next general-purpose spawn
in this repo — no need to re-route.

OFF SWITCH: PROMPER_ACTIVE=0 disables all of promper's automatic hooks (this injection, the
deep-dive nudge, and the spawn-brief rewrite). /promper, /prim, and /promper:setup are
unaffected — they stay available as the manual path regardless.
