---
name: promper
description: >
  Engineer a clean, role-grounded prompt from a rough request. Takes your messy intent,
  decomposes it inline, routes each piece to the proper specialist agent itself (in-session
  agent list first, lean map pieces under ~/.invoker/map/ as fallback), inherits that agent's
  persona as the prompt's role, then crafts the rest (context, instructions, examples,
  constraints, output format) inline against prompt-engineering best practices (Prompt
  Engineer agent on --deep). Presents plan + prompts first — never spawns on the first
  command; --run executes afterward with a per-node inline-vs-subagent decision. Triggers on:
  "engineer this prompt", "promper this", "make a good prompt for", "turn this into a prompt".
  Use when the user wants a better prompt, not an answer to their question.
---

# promper — Prompt Engineer (make · route · decide)

Turns a rough human request into a well-engineered, **role-grounded** prompt. The role is not
invented — it is inherited from the specialist agent the task routes to, and promper does that
routing itself, inline. promper *makes*; `prim` *guards*; the agents *are* the roles.

**Read first:** `~/Documents/GitHub/promper/reference/pe-principles.md` (the 11 principles, the
Claude-XML skeleton, and the Role-Inheritance Contract). All behavior below depends on it.

> **Hard dependency:** the [wshobson/agents](https://github.com/wshobson/agents) marketplace
> is promper's role source (registered as `claude-code-workflows`; bootstrap via
> `promper bootstrap`, which `/promper:setup` runs). promper never loads invokerai skills and
> never reads any map file whole — it walks the lean map at `~/.invoker/map/` built from that
> marketplace.

---

## Invocation

```
/promper <rough prompt or intent>
```

**Flags:**
- `--run` — after engineering and presenting the plan, execute it: per node, run inline or spawn the selected agent (Step 7.5 decision). Default is portable: return the prompt(s), spawn nothing.
- `--agent=<name>` — skip role discovery; force this agent as the role source.
- `--target=portable` (default) — standalone prompt, persona inlined into `<role>`.
- `--target=costar` — emit the CO-STAR skeleton instead of Claude-XML (for non-Claude / human use).
- `--deep` — spawn the Prompt Engineer agent for heavier drafting + proposed test cases (default crafting is inline; routing always stays inline).

---

## Flow

### Step 1 — Parse intent
Take `$ARGUMENTS` as the rough intent. If empty, ask: "What do you want a prompt for?" Stop until answered.

### Step 2 — Intent guard
Decide: is the user asking you to **engineer a prompt**, or to **answer a question**? If
ambiguous, ask one line: "Engineer this into a prompt, or just answer it?" This prevents the
classic failure where promper answers instead of engineering.

### Step 3 — Underspecification check
Scan the intent for missing **critical** slots: objective, audience, output format, key
constraints, examples. If one or more is missing AND cannot be safely inferred, ask **2–3
targeted clarifiers in a single batch** (not an interrogation). If the intent is already clear
enough, skip this step — speed matters.

### Step 4 — Decompose + route (inline, token-lean)

**4a. Decompose.** Build the `bead_graph` inline — nodes
`{id, domain, action, deps, parallel, agent}`. Most intents are ONE node; do not manufacture a
DAG. No tickets, no epic, no `pattern` label by default.

**Bead lifecycle (opt-in):** when the user tracks work in beads (`bd` on PATH and they ask, or
the session already uses beads), run the full lifecycle: optional epic for multi-node graphs
(`bd create "Task: <task>" --epic --json`), one child ticket per node
(`bd create "Step <id>: <action>" --parent <epic> --depends <deps> --json`), mark running at
execution start (`bd update <id> --status running`), close on completion
(`bd close <id> --reason "Completed by <agent>"`), note on failure, and prune the whole batch
at run end (`bd delete <id>`) so the store stays bounded. Every bd failure is non-blocking.

**4b. Route each node.** Discover the role-source agent yourself. Never load an invokerai
skill; never read any map file whole. Work down the tiers; stop at the first that yields
candidates. `--agent=<name>` skips discovery entirely.

- **Tier 1 — in-session agent list (0 tokens).** If your context already shows a list of
  available agents/subagent types with descriptions (e.g. the Agent tool's agent-type roster),
  select from it directly. Use this tier only when the list is actually visible in context AND
  contains domain specialists (not just general-purpose/Explore). Never recall, guess, or
  invent a list you cannot see.
- **Tier 2 — lean map pieces (~700 tokens typical).** Read `~/.invoker/map/index.json`
  (domains → agent names, ~1–2KB). Pick the 1–2 domains matching the node's `action`, then
  read those `~/.invoker/map/<domain>.json` pieces and walk entries one by one until confident.
- **Tier 3 — legacy map, jq slices only.** Pieces absent but `~/.invoker/agent-map.json`
  exists → size-gated jq:
  `jq -r '.domains | keys | join(", ")'` → for a matching domain,
  `jq '.domains["<d>"] | length'`; **≤15 agents:** `jq '[.domains["<d>"][] | {name, description}]'`;
  **>15:** names first (`jq -r '[.domains["<d>"][].name] | join(", ")'`), shortlist 3–5, then
  `jq '[.domains["<d>"][] | select(.name | IN("a","b","c")) | {name, description}]'`.
- **Tier 4 — nothing available.** The hard dependency is missing — tell the user to run
  `promper bootstrap` (installs the wshobson/agents marketplace and builds the map), proceed
  with a generic expert role for the inferred domain, and note the gap.

**Selection (all tiers):** the agent whose description most closely matches the node's
`action`. No good fit → generic expert role + explicit gap note.

### Step 5 — Inherit the role (persona + plugin toolkit)
For each node's selected agent, fetch its persona — first hit wins:
1. **Plugin agent** (the map piece carries a `plugin` field): resolve the piece's relative
   `file` against the `roots` array in `~/.invoker/map/index.json` — the `.md` body is the
   persona. Then inherit the plugin's toolkit: list
   `<root>/plugins/<plugin>/skills/` and `<root>/plugins/<plugin>/commands/` (names only,
   no file reads) and fold them into the role — portable prompts get one line,
   `This role carries the <plugin> toolkit — skills: <names>; commands: <names>`; `--run`
   spawns include the same list in the brief so the agent reaches for its own skills.
   Mechanical shortcut for spawn briefs: `promper hydrate <agent> "<task>"` emits the
   persona + toolkit + task as one spawn-ready prompt (`--json` for programmatic use) —
   spawn it via a `general-purpose` subagent; no plugin install needed.
2. Local agent: `~/.claude/agents/<file>` from the piece, else `~/.claude/agents/<name>.md`,
   then `./.claude/agents/<name>.md`.
3. Fallback: the description string already in hand (session list or map piece) — zero extra reads.
That persona becomes the node's `<role>`. **Never invent a role when an agent was selected.**

Optional but recommended: check the `prim` ledger (`~/.claude/agents/.prim-seal.json`). If the
source agent is uncertified or below the seal threshold, warn:
`role from <agent> — prim score <n>, may be weak. Run /prim to certify.`

### Step 6 — Craft the body (inline by default)
Fill the Claude-XML skeleton yourself against the 11 principles — pe-principles.md is already
loaded; no subagent needed. Complete `<context>`, `<instructions>`, `<examples>`,
`<constraints>`, `<output_format>`, and a `<thinking>` directive when the task needs reasoning.
`--target=costar` fills the CO-STAR skeleton instead.

**`--deep` only:** spawn the Prompt Engineer agent (subagent_type `"Prompt Engineer"`; agent
file `engineering-prompt-engineer.md`; if that identifier doesn't resolve, fall back to
`general-purpose` and note it) with the intent, chosen role(s), the 11-principle checklist, and
the skeleton — for heavier drafting plus proposed test cases. `--deep` affects this step only;
routing and role inheritance (Steps 4–5) stay inline.

**Multi-node:** one prompt per node, chained in dependency order (Principle 10); each
downstream prompt's `<context>` declares an `[OUTPUT OF PROMPT <n>]` slot. `--run` resolves
those slots at execution time.

### Step 7 — Self-critique
Grade the draft against the scoring rubric in the reference file. Silently patch any P0/P1 gaps
before presenting.

### Step 7.5 — Execute decision (only when running)
Nothing spawns on the first command. On explicit go / `--run`, decide **per node** where it
executes, and surface the choice with reasoning so the user can override:

| Node shape | Where it runs |
|---|---|
| Light: expected tool noise < ~5K tokens, no parallelism | **Inline** in the main context |
| Noisy: > ~5K tokens of exploration/output | **Subagent** (spawn the selected agent) |
| Parallel-safe siblings (`parallel: true`) | **Subagents**, spawned concurrently |
| Isolation matters (risky edits, throwaway exploration) | **Subagent** |

A subagent spawn costs a ~8–12K-token floor (system prompt + inherited CLAUDE.md) but keeps
noise out of the main window; inline is ~4× cheaper for light work but its output is re-sent
every later turn. Prefer caveman-compressed agents (cavecrew) when available — their returned
results are ~60% smaller.

Report format: `node-1 → inline (light)` · `node-2 → subagent backend-developer (noisy, parallel)`.

Record the decision at `~/.invoker/state/promper-decision.json` —
`{"verdict":"inline"|"agent"|"mixed","repo":"<repo root>","reason":"<one line>","ts":<epoch ms>}`.
The edit gate honors it: verdict `inline`/`mixed` unlocks direct edits in the repo (60-min TTL);
verdict `agent` means the work must go to the spawned specialist.

When beads are on (Step 4a), execution drives the ticket lifecycle: mark the node's ticket
running at start, close it with the executing agent's name on completion, prune the batch when
the run ends.

### Step 8 — Output
**Portable (default):** present each engineered prompt in a fenced block, copy-paste ready, with
the persona inlined into `<role>`. Above it, a one-line routing header:
`routed → <agent> (via <session list | map | --agent>) → role = <summary>`. Below it, a short
"what I added & why" note and a list of any open slots the user must fill (e.g. real examples
marked `[DRAFT — replace]`). **Zero spawns.**

**--run:** after presenting the plan, execute per the Step 7.5 decisions — inline nodes run in
the main context; subagent nodes spawn the selected agent via the Agent tool with the crafted
brief (role implicit), respecting `deps` order and `parallel` flags, feeding each upstream
node's result into downstream `[OUTPUT OF PROMPT <n>]` slots. Report results.

---

## Edge cases
- **Already-strong intent / prompt:** light touch — note it's already solid, suggest only deltas.
- **Oversized or multi-task intent:** prefer chaining; surface the graph and one prompt per node.
- **No matching agent:** generic expert role + explicit gap note + suggestion to install/author an agent (or run `/promper:setup` to build the routing map).
- **Empty args:** ask what to engineer.
- **User pasted a question expecting an answer:** intent guard (Step 2) catches this.

---

## Example (portable, single node)

**Input:** `/promper write a tweet announcing my budgeting app`

**Routing:** `routed → content-marketer (via map) → role = SEO-savvy multi-channel content strategist`

**Output (excerpt):**
```
<role>
You are a multi-channel content strategist who writes high-engagement social copy and
understands platform-native voice and hooks.
</role>
<context>
Product: a personal budgeting app. Goal: announce launch on X/Twitter and drive sign-ups.
Audience: budget-conscious millennials/Gen-Z.
</context>
<instructions>
1. Write 3 distinct tweet options, each under 280 characters.
2. Lead with a hook; include one concrete benefit and a clear CTA.
3. No hashtag spam — at most 2 relevant tags.
</instructions>
<constraints>
- No emojis unless they add meaning. If a claim needs a real metric, mark it [INSERT METRIC].
</constraints>
<output_format>
Three numbered tweets, each on its own line, with a one-line rationale beneath it.
</output_format>
```
**What I added:** role (inherited from content-marketer), audience, hook/CTA structure, length
bound, hallucination guard on metrics. **Open slots:** real product name + a launch metric.
