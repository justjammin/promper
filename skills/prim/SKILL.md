---
name: prim
description: >
  Evaluate agent files against promper's prompt-engineering standard and issue the "seal of
  approval". Audits each selected agent's system prompt for role clarity, structure, examples,
  output spec, constraints, and hallucination guards; scores 0–100 with P0/P1/P2 findings; and
  optionally rewrites failing agents with --fix. prim guards the role source that promper
  inherits from. Triggers on: "evaluate my agents", "certify agents", "prim", "audit agent
  prompts", "seal of approval". Never evaluates agents without the user's explicit OK on the set.
---

# prim — Agent Prompt Evaluator & Certifier

`prim` (prim + proper) certifies that the agents promper inherits roles from are actually
well-engineered prompts. A sloppy agent → a sloppy inherited `<role>`. prim is the QA layer for
the role source: promper *makes*, prim *guards*.

**Read first:** `~/Documents/GitHub/promper/reference/pe-principles.md` — the 11 principles, the
scoring rubric, severity definitions, and seal threshold. Score strictly against it.

---

## Invocation

```
/prim [agent names or globs]
```

**Flags:**
- `--all` — evaluate every discovered agent (still requires one confirmation before starting).
- `--fix` — after scoring, rewrite failing agents to pass. **Gated and guarded — see below.**
- `--report=<path>` — write the full report to a file in addition to displaying it.

---

## Flow

### Step 1 — Discover agents
Find agent files in (in order): `~/.claude/agents/`, `./.claude/agents/`, `./.agents/`, and the
plugin agent paths referenced by `~/.invoker/agent-map.json`. For each, record: name, **source
path**, and whether it is **user-authored** (`~/.claude/agents/` or a project dir) or
**plugin-provided** (inside `~/.claude/plugins/...`). This distinction is critical for `--fix`.

### Step 2 — User gates the set (mandatory)
Display the discovered agents grouped by user vs plugin. Ask the user which to evaluate. Accept:
explicit names/globs from the invocation, `--all`, or an interactive pick. **Never evaluate an
agent the user did not approve.**

### Step 3 — Score each agent
Read each approved agent's system prompt. Score 0–100 using the rubric in the reference file.
Produce, per agent: score, letter grade, P0/P1/P2 findings, and one concrete fix per finding.
Waive examples / chain-of-thought only when the agent's task genuinely doesn't need them — and
say so explicitly in the report.

### Step 4 — Seal
Seal of approval = **score ≥ 80 AND zero P0**. Record results to the ledger
`~/.claude/agents/.prim-seal.json`, keyed by agent name + source path + a content hash of the
agent file (so the seal invalidates automatically when the agent changes). Store: score, grade,
pass (bool), P-counts, and a timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`). **Ledger only — do not
stamp anything into the agent files themselves.**

### Step 5 — Output
Per-agent report (score, grade, findings + fixes, seal pass/fail) plus a roster summary:
`N sealed · M need work`. This is what promper's Step 5 warning reads from.

---

## `--fix` (gated, guarded)

Rewriting agent prompts mutates files the user may not have authored. Apply ALL of these:

1. **Scope:** only agents that failed the seal AND that the user approved in Step 2.
2. **User vs plugin (the durability trap):**
   - **User-authored agents** (`~/.claude/agents/` etc.): safe to edit in place.
   - **Plugin-provided agents** (inside `~/.claude/plugins/...`): **do not edit silently.** A
     `/plugin update` will revert the file (the same cache-revert trap that bites plugin skill
     edits). Warn the user. Offer instead to write a corrected **copy** into `~/.claude/agents/`
     (which overrides the plugin agent and survives updates), and say that's what you're doing.
3. **Per-file confirmation + diff:** for each file you would change, show a unified diff of the
   proposed rewrite and get an explicit yes before writing. Never batch-overwrite.
4. **Preserve contract:** keep the agent's frontmatter `name`, `description`, and `tools` intact —
   improve the *body/system prompt*, not the agent's identity or capabilities.
5. **Re-score after fix:** re-run Step 3 on the rewritten agent and update the ledger.

---

## Output example

```
Agents evaluated: 4 (3 user, 1 plugin)

  my-researcher        88  B+   ✓ SEALED
  my-writer            71  C    ✗ needs work
       P1: generic role ("you are a helpful writer") — give a specific persona
       P1: no output format on a formatting task — specify structure + sample
       P2: examples are all happy-path — add an edge case
  data-cleaner         64  D    ✗ needs work
       P0: core task is ambiguous ("handle the data") — define the exact transform
  vendor-agent (plugin) 79 C+   ✗ needs work
       P1: no hallucination guard — allow "I don't know"
       note: plugin-provided — --fix would write an override copy to ~/.claude/agents/

Roster: 1 sealed · 3 need work   →   ledger updated
```
