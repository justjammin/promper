---
name: promper-setup
description: >
  Build promper's lean routing map from installed agents. Wraps the deterministic TypeScript
  scanner (`promper scan`) — zero LLM tokens for scanning and classification — then uses
  judgment only to domain-assign the scanner's `unmapped` leftovers. Run once, or when agents
  change. Triggers on: "promper setup", "rebuild the agent map", "refresh promper routing".
---

# promper:setup — build the lean routing map

Produces the map pieces `/promper` walks during role discovery. The scan itself is
deterministic code, not model work — your only judgment call is placing the agents the
keyword classifier could not.

---

## Output artifact

```
~/.invoker/map/
  index.json            { "version": 1, "domains": { "<domain>": ["<agent-name>", ...], ... } }
  <domain>.json         [ { "name": "...", "description": "...", "file": "<basename>.md",
                            "model": "..." (only if declared) }, ... ]
```

- Frontmatter fields only; **`tools` is never stored in pieces** (largest source of map bloat).
- One file per domain so a routing pass reads only the piece it needs.

---

## Flow

### Step 1 — Bootstrap the role source (deterministic, zero LLM)

promper's role source is a **hard dependency**: the
[wshobson/agents](https://github.com/wshobson/agents) plugin marketplace (registered as
`claude-code-workflows`). One command installs it when missing and scans it:

```bash
npx @ninjamin/promper bootstrap
# or, from a local checkout: node <repo>/bin/promper.mjs bootstrap
```

Bootstrap runs `claude plugin marketplace add wshobson/agents` if the cache is absent, then
`promper scan --plugins ~/.claude/plugins/marketplaces/claude-code-workflows --no-defaults`.
To refresh after upstream changes: `claude plugin marketplace update claude-code-workflows`,
then re-run bootstrap. For supplementary local agents or other sources, use `promper scan`
directly:

```bash
npx @ninjamin/promper scan
```

Flags: `--check` dry run · `--dir <path>` extra agent dirs (repeatable) ·
`--plugins <root>` scan a plugin marketplace (repeatable) · `--no-defaults` skip the default
agent dirs · `--out <path>` alternate map dir.

Default scan dirs: `~/.claude/agents`, `./.claude/agents`, `~/.codex/agents`,
`~/.gemini/agents`. The scanner is idempotent and additive: existing domain assignments are
authoritative (it never moves or renames), it classifies only new agents (name table →
description keywords → `unmapped`), drops entries whose source `.md` vanished, and writes
sorted, byte-stable files.

**Plugin marketplaces (e.g. wshobson/agents):** `--plugins <root>` walks
`<root>/plugins/*/agents/*.md`. Entries record the owning `plugin` and a root-relative
`file`; the root lands in `index.json` (`roots`) so `/promper` can resolve personas AND
inherit the plugin's `skills/` + `commands/` toolkit at role time. Plugin entries win name
collisions against the default dirs. For a marketplace-canonical map use
`--plugins <root> --no-defaults`. Rescans of a plugins map must repeat `--plugins <root>`.

### Step 2 — Relay the report
Show the user: map path, domain and agent counts, new agents, dropped agents, unmapped list.

### Step 3 — Place the unmapped + fold stray domains (the only LLM step)
For each agent in the `unmapped` piece: its description is already in the piece — pick the
best-fitting existing domain from `index.json`, or a new domain only if genuinely distinct
(keep the taxonomy ~15–40 domains; no per-agent singletons). Move the entry: append to the
target `<domain>.json`, remove from `unmapped.json`, update both lists in `index.json`, keep
everything sorted. Cost: ~60 tokens per unmapped agent.

Also check the report for **new domains the scanner created this run**. The scanner
auto-aliases ported-taxonomy names into the existing taxonomy when exactly one match exists
(`backend` → `engineering-backend`); a genuinely new or ambiguous domain still lands under
its classifier name. If it duplicates an existing domain in meaning, fold it in the same way:
move the entries, delete the stray piece, update `index.json`.

---

## Edge cases
- **No agents found anywhere:** say so; suggest installing agents before relying on role inheritance.
