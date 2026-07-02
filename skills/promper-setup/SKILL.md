---
name: promper-setup
description: >
  Build promper's lean routing map from installed agents. Scans agent directories, extracts
  frontmatter only (name, description, file), groups agents into domains, and writes split
  map pieces to ~/.invoker/map/ (a tiny index plus one small file per domain) so routing
  never reads a large file. Run once, or when agents change. Offers a one-shot conversion
  from a legacy invokerai agent-map.json when present. Triggers on: "promper setup",
  "rebuild the agent map", "refresh promper routing".
---

# promper:setup — build the lean routing map

Produces the map pieces `/promper` walks during role discovery. Design goal: **no large file
ever needs to be read at routing time.** The index stays around 1–2KB; each domain piece is a
few KB of `{name, description, file}` entries.

---

## Output artifact

```
~/.invoker/map/
  index.json            { "version": 1, "domains": { "<domain>": ["<agent-name>", ...], ... } }
  <domain>.json         [ { "name": "...", "description": "...", "file": "<basename>.md",
                            "model": "..." (only if declared) }, ... ]
```

Rules for pieces:
- **Frontmatter fields only**: `name`, `description`, `file` (basename of the source `.md`),
  and `model` when the agent declares one.
- **Never store `tools`** — routing never needs it, and tools strings are the single largest
  source of map bloat.
- One file per domain so a routing pass reads only the piece it needs.

The legacy invokerai map (`~/.invoker/agent-map.json`) is **left untouched** — `prim` and any
invokerai flows still read it. promper's pieces are the canonical routing source.

---

## Flow

### Step 1 — Fast path: convert a legacy map
If `~/.invoker/agent-map.json` exists and `~/.invoker/map/index.json` does not, offer a
one-shot conversion (no agent rescan needed):

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

Report the piece count and stop — done. Only continue to Step 2 for a fresh scan (no legacy
map, or the user asks for a rescan).

### Step 2 — Scan agent files
Scan, in order: `~/.claude/agents/`, `./.claude/agents/`, plus any plugin agent directories
you know are installed. For each `*.md`, read **frontmatter only** (do not read agent bodies):
`name`, `description`, `model` if present. Record the basename as `file`.

### Step 3 — Group into domains
Group agents into a bounded domain taxonomy (~15–40 named domains). Singleton domains only
for genuinely distinct fields; never one domain per agent. When pieces already exist, keep the
existing domain assignments and bucket only the new/changed agents (idempotent + additive —
never clobber hand-edits).

### Step 4 — Write the pieces
Write `index.json` and each `<domain>.json` per the artifact spec above. Then report:

```
promper map: ~/.invoker/map/ — <N> domains, <M> agents, index <K>B
new since last run: <names or "none">
unmapped (no description): <names or "none">
```

---

## Edge cases
- **No agents found anywhere:** say so; suggest installing agents before using role inheritance.
- **Agent renamed/deleted:** on rescan, drop entries whose source file no longer exists; note them.
- **Both legacy map and pieces exist:** pieces win for routing; offer to refresh pieces from a
  rescan if the legacy map looks newer.
