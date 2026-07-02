# Prompt-Engineering Principles & Skeleton

Single source of truth for both `promper` (make) and `prim` (evaluate). Both skills read
this file. Do not duplicate its contents into the skill files — cite it.

---

## The 11 Principles

Ranked roughly by impact. A strong prompt satisfies the relevant ones; not every prompt
needs every principle (e.g. a trivial classification prompt may not need chain-of-thought).

1. **Clear, direct, detailed.** State the task explicitly. Give the context a competent
   stranger would need. Say what TO do, not only what to avoid.
2. **Examples (multishot).** 1–5 diverse, relevant examples in `<example>` tags. The single
   biggest quality lever after clarity. Examples should cover edge cases, not just the happy path.
3. **Let it think (chain-of-thought).** For any task requiring reasoning, instruct a
   step-by-step pass in a `<thinking>` block before the final answer. Skip for simple lookups.
4. **Structure with XML tags.** Separate instructions from data from examples with tags Claude
   is trained on: `<role>`, `<context>`, `<instructions>`, `<examples>`, `<constraints>`,
   `<output_format>`, `<thinking>`. Reduces instruction/data bleed.
5. **Role / persona.** A specific expert role sharpens expertise and tone. (In this toolkit the
   role is *inherited* from the routed specialist agent — see Role-Inheritance Contract below.)
6. **Explicit output format.** Describe the format AND show a sample. Prefill or specify the
   exact shape (JSON keys, sections, length) rather than hoping.
7. **Give the "why".** State the motivation/goal. Aligned intent → better-aligned output.
8. **Constraints & success criteria.** Bounds (length, scope, must/must-not). Define what a
   correct answer looks like. Explicitly allow "I don't know" to cut hallucination.
9. **Long-context ordering.** Put large documents/data near the TOP; put the actual ask at the
   BOTTOM. Ask the model to ground answers in quotes from the source.
10. **Chain, don't cram.** Split a fat, multi-stage task into linked subprompts rather than one
    overloaded prompt. (Falls out naturally from a multi-node bead_graph: one prompt per node.)
11. **Treat as testable.** A prompt is a draft against success criteria, not a one-shot. Note
    what would need an eval / test case to verify.

---

## Claude-Native XML Skeleton (default)

The default structure `promper` emits. Omit tags that don't apply; never emit empty tags.

```
<role>
{Inherited from the routed agent's persona. Specific expertise + stance.}
</role>

<context>
{Background, inputs, and the WHY. Large reference material goes here, near the top.}
</context>

<instructions>
1. {Explicit, ordered, positive steps.}
2. {Say what to do.}
3. {Edge handling.}
</instructions>

<examples>
<example>
Input: {…}
Output: {…}
</example>
</examples>

<constraints>
- {Bounds, must/must-not, length.}
- If unsure or information is missing, say so rather than inventing.
</constraints>

<output_format>
{Describe the exact shape, then show a short sample.}
</output_format>

<!-- Include only for reasoning tasks: -->
<thinking>
Work through the problem step by step before answering.
</thinking>

{The actual task / question goes last.}
```

### CO-STAR skeleton (`--target=costar`, for portable / non-Claude prompts)

```
# CONTEXT
# OBJECTIVE
# STYLE
# TONE
# AUDIENCE
# RESPONSE FORMAT
```

---

## Role-Inheritance Contract

The architecture's keystone. The `<role>` is **never invented** — it is inherited from the
specialist agent the task routes to. promper performs the routing itself, inline:

1. **Decompose inline.** Build a `bead_graph` ({id, domain, action, deps, parallel, agent});
   most intents are one node. No tickets or `bd` commands by default (opt-in when the user
   tracks work in beads).
2. **Discover the role-source agent, cheapest source first:** (a) the in-session agent list
   already in context, when actually visible; (b) else the lean map pieces —
   `~/.invoker/map/index.json` then the matching `<domain>.json`, entries walked piecewise;
   (c) else size-gated jq slices of the legacy `~/.invoker/agent-map.json`; (d) else suggest
   `/promper:setup` and use a generic expert role, noting the gap. Never read any map file
   whole. Selection at every tier: the agent whose description best matches the node's `action`.
3. **Inherit the persona:** the agent's own `.md` body when readable (high fidelity), else its
   `description` string. That persona IS the `<role>`.
4. Multi-node graph ⇒ one engineered prompt per node, chained (Principle 10), each with its node's role.
5. **Portable mode:** inline the persona text into `<role>` so the prompt stands alone.
   **Run mode:** the role is implicit (the agent already carries its system prompt), so `<role>`
   stays thin and the prompt is a crisp task brief handed to that agent. Execution placement
   (inline vs subagent) is a per-node token decision — see promper Step 7.5.
6. Always surface the routing decision: `routed → <agent> (via <source>) → role = <summary>`.

---

## Scoring rubric (used by `prim`)

Score each agent/prompt 0–100 against the principles. Suggested weighting:

| Dimension | Weight | Checks |
|---|---|---|
| Role clarity | 15 | Specific persona, not generic "you are a helpful assistant" |
| Task clarity & directness | 20 | Unambiguous objective; positive instructions |
| Structure | 15 | XML tags / clear sections separating instruction from data |
| Examples | 15 | Present, diverse, relevant (waivable for trivial tasks — note the waiver) |
| Output format | 10 | Described + sampled |
| Constraints & "I don't know" | 10 | Bounds present; hallucination guard present |
| Reasoning (CoT) | 10 | Present where the task needs it (waivable — note it) |
| Context / "why" | 5 | Motivation stated |

**Severity of findings:** P0 = breaks the prompt (ambiguous core task, contradictory
instructions, no output spec on a formatting task). P1 = materially weakens it (no examples on a
nuanced task, generic role, missing hallucination guard). P2 = polish (wording, ordering, minor
structure).

**Seal of approval** = score ≥ 80 AND zero P0.
