---
name: promper
description: >
  Engineer a clean, role-grounded prompt from a rough request. Takes your messy intent,
  routes it through invokerai to discover the proper agent, inherits that agent's persona as
  the prompt's role, then crafts the rest (context, instructions, examples, constraints, output
  format) via the Prompt Engineer agent and prompt-engineering best practices. Returns a
  portable copy-paste prompt by default, or runs it end-to-end with --run. Triggers on:
  "engineer this prompt", "promper this", "make a good prompt for", "turn this into a prompt".
  Use when the user wants a better prompt, not an answer to their question.
---

# promper — Prompt Engineer (make)

Turns a rough human request into a well-engineered, **role-grounded** prompt. The role is not
invented — it is inherited from the agent invokerai would route the task to. promper *makes*;
`prim` *guards*; invokerai *routes*; the agents *are* the roles.

**Read first:** `~/Documents/GitHub/promper/reference/pe-principles.md` (the 11 principles, the
Claude-XML skeleton, and the Role-Inheritance Contract). All behavior below depends on it.

> **CLAUDE.md carve-out:** promper is explicitly permitted to invoke `/invokerai:decompose` and
> `/invokerai:spawn`. Driving invokerai's routing to inherit agent roles IS promper's function.
> The general "skills don't call invokerai" rule does not apply here.

---

## Invocation

```
/promper <rough prompt or intent>
```

**Flags:**
- `--run` — after engineering, spawn the selected agent(s) with the brief and execute (default is portable: return the prompt, don't run it).
- `--agent=<name>` — override invokerai's pick; force this agent as the role source.
- `--target=portable` (default) — standalone prompt, persona inlined into `<role>`.
- `--target=costar` — emit the CO-STAR skeleton instead of Claude-XML (for non-Claude / human use).
- `--deep` — hand the whole job to the Prompt Engineer agent for heavier drafting + test cases.

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

### Step 4 — Route via invokerai (role discovery)
Perform invokerai's decompose + spawn-selection flow:
- Read `~/.invoker/agent-map.json` for valid domains and their agents.
- Invoke `/invokerai:decompose` (or build the equivalent `bead_graph` inline): identify the
  domain(s) and action(s) for this intent. Most prompts are a single node; complex intents are a DAG.
- Invoke `/invokerai:spawn`'s selection logic (or do it inline): for each node, pick the
  best-match `agent` by matching the node's `action` to each candidate agent's `description`.
- If `--agent=<name>` is set, skip selection and use that agent for the (single) node.
- If no agent fits a node, fall back to a generic expert role and **note the gap** to the user.

### Step 5 — Inherit the role
For each node's selected agent, read its persona (the `description` in `agent-map.json`; read the
agent's own `.md` for high fidelity). That persona becomes the node's `<role>`. **Never invent a
role when an agent was selected.**

Optional but recommended: check the `prim` ledger (`~/.claude/agents/.prim-seal.json`). If the
source agent is uncertified or below the seal threshold, warn:
`role from <agent> — prim score <n>, may be weak. Run /prim to certify.`

### Step 6 — Craft the body (Prompt Engineer)
Spawn the **Prompt Engineer** agent (subagent_type `"Prompt Engineer"`; agent file
`engineering-prompt-engineer.md`. If that identifier doesn't resolve, fall back to
`general-purpose` and note it) with: the intent, the chosen
role(s), the 11-principle checklist, and the Claude-XML skeleton from the reference file. It fills
`<context>`, `<instructions>`, `<examples>`, `<constraints>`, `<output_format>`, and a `<thinking>`
directive when the task needs reasoning. For `--target=costar`, it fills the CO-STAR skeleton instead.
(`--deep` hands it the entire job including role assembly and proposed test cases.)

For a multi-node DAG, produce one prompt per node, chained in dependency order (Principle 10).

### Step 7 — Self-critique
Grade the draft against the scoring rubric in the reference file. Silently patch any P0/P1 gaps
before presenting.

### Step 8 — Output
**Portable (default):** present each engineered prompt in a fenced block, copy-paste ready, with
the persona inlined into `<role>`. Above it, a one-line routing header:
`invokerai picked <agent> → role = <summary>`. Below it, a short "what I added & why" note and a
list of any open slots the user must fill (e.g. real examples marked `[DRAFT — replace]`).

**--run:** instead of returning the prompt, spawn the selected agent(s) via the Agent tool with
the crafted brief (role implicit), respecting DAG order and `parallel` flags. Report results.

---

## Edge cases
- **Already-strong intent / prompt:** light touch — note it's already solid, suggest only deltas.
- **Oversized or multi-task intent:** prefer chaining; surface the DAG and one prompt per node.
- **No matching agent:** generic expert role + explicit gap note + suggestion to install/author an agent (or run `/invokerai:setup`).
- **Empty args:** ask what to engineer.
- **User pasted a question expecting an answer:** intent guard (Step 2) catches this.

---

## Example (portable, single node)

**Input:** `/promper write a tweet announcing my budgeting app`

**Routing:** `invokerai picked content-marketer → role = SEO-savvy multi-channel content strategist`

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
