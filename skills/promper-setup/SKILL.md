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
- The legacy `~/.invoker/agent-map.json` is left untouched (`prim` still reads it); refresh it
  with `--legacy` when wanted.

---

## Flow

### Step 1 — Run the scanner (deterministic, zero LLM)

```bash
npx @ninjamin/promper scan
# or, from a local checkout: node <repo>/bin/promper.mjs scan
```

Flags: `--check` dry run · `--dir <path>` extra agent dirs (repeatable) · `--legacy` also
refresh the legacy agent-map.json · `--out <path>` alternate map dir.

Default scan dirs: `~/.claude/agents`, `./.claude/agents`, `~/.codex/agents`,
`~/.gemini/agents`. The scanner is idempotent and additive: existing domain assignments are
authoritative (it never moves or renames), it classifies only new agents (name table →
description keywords → `unmapped`), drops entries whose source `.md` vanished, and writes
sorted, byte-stable files.

### Step 2 — Relay the report
Show the user: map path, domain and agent counts, new agents, dropped agents, unmapped list.

### Step 3 — Place the unmapped (the only LLM step)
For each agent in the `unmapped` piece: its description is already in the piece — pick the
best-fitting existing domain from `index.json`, or a new domain only if genuinely distinct
(keep the taxonomy ~15–40 domains; no per-agent singletons). Move the entry: append to the
target `<domain>.json`, remove from `unmapped.json`, update both lists in `index.json`, keep
everything sorted. Cost: ~60 tokens per unmapped agent.

---

## Fallback — scanner unavailable

Node/npx missing but a legacy `~/.invoker/agent-map.json` exists → one-shot jq conversion
(no rescan):

```bash
mkdir -p ~/.invoker/map
jq '{version: 1, domains: (.domains | map_values([.[].name]))}' \
  ~/.invoker/agent-map.json > ~/.invoker/map/index.json
for d in $(jq -r '.domains | keys[]' ~/.invoker/agent-map.json); do
  jq --arg d "$d" \
    '[.domains[$d][] | {name, description, file: (.file // (.name + ".md"))} + (if .model then {model: .model} else {} end)]' \
    ~/.invoker/agent-map.json > ~/.invoker/map/"$d".json
done
```

## Edge cases
- **No agents found anywhere:** say so; suggest installing agents before relying on role inheritance.
- **Both legacy map and pieces exist:** pieces win for routing; `--legacy` re-syncs the old file.
