/**
 * scan.ts — `promper scan`: deterministically build promper's lean routing map.
 *
 * Output layout (default ~/.invoker/map/):
 *   index.json     { "version": 1, "roots"?: [...], "domains": { "<domain>": ["<agent-name>", ...] } }
 *   <domain>.json  [ { "name", "description", "file", "model"?, "plugin"? }, ... ]
 *   toolkits.json  { "<plugin>": { "skills": [{name,description,file}], "commands": [...] } }
 *                  — keyed by PLUGIN (not domain: a domain can span several plugins, and
 *                  skills/commands belong to the plugin). Description-matchable, for routing
 *                  suggestions (SKILL.md Step 4b/5) — distinct from hydrate.ts's toolkit
 *                  listing, which is name-only and read live at spawn time.
 *
 * Zero LLM.
 *
 * Three agent sources, in this scan order (earlier sources win name collisions):
 *   1. `--plugins <root>` — wshobson-style marketplaces: `<root>/plugins/<plugin>/agents/*.md`.
 *      Entries carry a `plugin` field; persona fetch also lists that plugin's skills/+commands/.
 *      Only plugins listed as installed in `~/.claude/plugins/installed_plugins.json` are
 *      scanned — a marketplace checkout ships every plugin it publishes, not just the ones
 *      the user enabled. See `loadInstalledPluginKeys()`.
 *   2. `--categories <root>` — category-flat agent repos: `<root>/<category>/*.md`, no nested
 *      `agents/` folder and no per-category toolkit (e.g. awesome-claude-code-subagents,
 *      agency-agents). No `plugin` field.
 *   3. Flat agent directories (`~/.claude/agents`, `--dir <path>`, ...) — scanDirs().
 * `--plugins` and `--categories` roots are unioned into the same `roots` array in index.json;
 * relative `file` paths from either source resolve against it identically.
 *
 * Merge rules:
 *   - Existing agent→domain assignments in index.json are authoritative:
 *     agents are never moved between domains and domains are never renamed.
 *   - Only agents not already present are classified (ported taxonomy).
 *   - Agents whose source file vanished are dropped and reported.
 *   - Agents whose plugin was uninstalled since the last scan are also dropped and
 *     reported, even though the marketplace checkout still has their files on disk.
 *   - Output is fully sorted so re-runs are byte-identical.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { classify } from "./classify.js";
import { flattenDescription, normalizeTools, parseFrontmatter } from "./frontmatter.js";

const MAP_VERSION = 1;

interface PieceEntry {
  name: string;
  description: string;
  file: string;
  model?: string;
  [extra: string]: unknown;
}

interface ScannedAgent {
  name: string;
  description: string;
  file: string;
  model?: string;
  plugin?: string;
  /** name used for domain classification (prefix-stripped for plugin agents) */
  classifyName: string;
  tools: string[];
  hasDescription: boolean;
}

interface ScanOptions {
  extraDirs: string[];
  pluginRoots: string[];
  categoryRoots: string[];
  noDefaults: boolean;
  check: boolean;
  outDir: string;
}

interface ExistingMap {
  /** agent name → domain (first occurrence wins) */
  assignments: Map<string, string>;
  /** agent name → piece entry as previously written */
  entries: Map<string, PieceEntry>;
  /** previous domain list (for stale-piece cleanup) */
  domains: string[];
  /** roots previously recorded in index.json (persist across scans that don't repeat every flag) */
  roots: string[];
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ScanOptions {
  const opts: ScanOptions = {
    extraDirs: [],
    pluginRoots: [],
    categoryRoots: [],
    noDefaults: false,
    check: false,
    outDir: path.join(homedir(), ".invoker", "map"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir": {
        const value = argv[++i];
        if (!value) throw new Error("--dir requires a path");
        opts.extraDirs.push(value);
        break;
      }
      case "--plugins": {
        const value = argv[++i];
        if (!value) throw new Error("--plugins requires a marketplace root path");
        opts.pluginRoots.push(value);
        break;
      }
      case "--categories": {
        const value = argv[++i];
        if (!value) throw new Error("--categories requires a repo root path");
        opts.categoryRoots.push(value);
        break;
      }
      case "--out": {
        const value = argv[++i];
        if (!value) throw new Error("--out requires a path");
        opts.outDir = value;
        break;
      }
      case "--check":
        opts.check = true;
        break;
      case "--no-defaults":
        opts.noDefaults = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function defaultScanDirs(): string[] {
  const home = homedir();
  return [
    path.join(home, ".claude", "agents"),
    path.join(process.cwd(), ".claude", "agents"),
    path.join(home, ".codex", "agents"),
    path.join(home, ".gemini", "agents"),
  ];
}

/** Scan all dirs for *.md agent files. First occurrence of a name wins. */
async function scanDirs(
  dirs: string[],
  agents: Map<string, ScannedAgent> = new Map(),
): Promise<Map<string, ScannedAgent>> {
  for (const dir of dirs) {
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(dir);
    } catch {
      continue; // skip missing dirs silently
    }
    fileNames.sort();
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".md")) continue;
      const fullPath = path.join(dir, fileName);
      let text: string;
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        text = await fs.readFile(fullPath, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(text);
      if (fm === null) continue;

      let name = typeof fm["name"] === "string" ? (fm["name"] as string).trim() : "";
      if (!name) name = path.basename(fileName, ".md"); // fallback: filename stem
      if (agents.has(name)) continue;

      const description = flattenDescription(fm["description"]);
      const modelRaw = fm["model"];
      const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;

      const agent: ScannedAgent = {
        name,
        description,
        file: fileName,
        classifyName: name,
        tools: normalizeTools(fm["tools"]),
        hasDescription: description.length > 0,
      };
      if (model !== undefined) agent.model = model;
      agents.set(name, agent);
    }
  }
  return agents;
}

/**
 * Reads Claude Code's own record of which plugins the user actually installed
 * (`~/.claude/plugins/installed_plugins.json`, keyed `"<plugin>@<marketplace>"`).
 * A marketplace root (e.g. wshobson/agents) can carry far more plugins than any one
 * user has installed — scanning every plugin dir would map agents the user can't
 * even invoke. Returns null when the file is missing/unreadable so callers fall back
 * to unfiltered scanning (e.g. non-Claude-Code environments).
 */
async function loadInstalledPluginKeys(): Promise<Set<string> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(homedir(), ".claude", "plugins", "installed_plugins.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { plugins?: unknown };
    if (typeof parsed.plugins !== "object" || parsed.plugins === null) return null;
    return new Set(Object.keys(parsed.plugins));
  } catch {
    return null;
  }
}

/**
 * Reads `~/.claude/plugins/known_marketplaces.json` — keyed by marketplace name, each
 * entry carrying the exact `installLocation` Claude Code cloned it to. Returns a map from
 * resolved `installLocation` -> marketplace name.
 *
 * This, not `path.basename(root)`, is the correct way to ask "is this `--plugins` root a
 * marketplace Claude Code tracks installs for, and if so what's its registered name?":
 *   - A basename guess gives a false POSITIVE for a raw git clone that happens to share a
 *     marketplace's directory name (the README's own `--plugins ~/Documents/GitHub/
 *     wshobson-agents` example isn't the registered `claude-code-workflows` marketplace).
 *   - Deriving "recognized" from which marketplace names *currently appear* in
 *     installed_plugins.json's "@suffix"es gives a false NEGATIVE the moment a
 *     marketplace's last remaining plugin gets uninstalled: its suffix vanishes from that
 *     file entirely, so a suffix-presence check would then treat the whole marketplace as
 *     unrecognized and fall back to scanning it unfiltered — the opposite of what
 *     uninstalling everything from it should do (scan zero plugins from it).
 * Matching on the registered installLocation has neither failure mode.
 */
async function loadKnownMarketplaces(): Promise<Map<string, string> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(homedir(), ".claude", "plugins", "known_marketplaces.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const byPath = new Map<string, string>();
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const loc = (value as Record<string, unknown>)["installLocation"];
      if (typeof loc === "string" && loc.trim()) byPath.set(path.resolve(loc), name);
    }
    return byPath.size > 0 ? byPath : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a `--plugins <root>` to its registered marketplace name, or null when the root
 * isn't a marketplace Claude Code tracks (unfiltered-scan case).
 */
function resolveMarketplaceName(root: string, known: Map<string, string> | null): string | null {
  return known?.get(path.resolve(root)) ?? null;
}

/**
 * Scan plugin-marketplace roots (wshobson/agents layout): `<root>/plugins/<plugin>/agents/*.md`.
 * Entries record the owning `plugin` and a root-relative `file` path so persona fetch (and the
 * plugin's skills/ + commands/) resolve from the root stored in index.json. Frontmatter names
 * are typically plugin-prefixed ("backend-development-backend-architect"), so classification
 * uses the prefix-stripped file stem, which hits the name table.
 *
 * For roots resolved to a registered marketplace (see `loadKnownMarketplaces()`), only
 * plugins the user has actually installed from it are scanned. Roots that aren't a
 * registered marketplace (a raw checkout Claude Code never cloned itself) scan unfiltered,
 * same as before this filter existed. Filtered-out `"<plugin>@<marketplace>"` keys are
 * recorded in `excludedPluginKeys` so `runScan` can drop stale map entries for plugins that
 * were uninstalled since the last scan, instead of reviving them via the stale-file fallback.
 */
async function scanPluginRoots(
  roots: string[],
  agents: Map<string, ScannedAgent>,
  excludedPluginKeys: Set<string>,
): Promise<void> {
  const installed = await loadInstalledPluginKeys();
  const known = await loadKnownMarketplaces();
  for (const root of roots) {
    const pluginsDir = path.join(root, "plugins");
    let pluginNames: string[];
    try {
      pluginNames = await fs.readdir(pluginsDir);
    } catch {
      continue;
    }
    pluginNames.sort();
    const marketplace = resolveMarketplaceName(root, known);
    for (const plugin of pluginNames) {
      if (installed !== null && marketplace !== null && !installed.has(`${plugin}@${marketplace}`)) {
        excludedPluginKeys.add(`${plugin}@${marketplace}`);
        continue;
      }
      const agentsDir = path.join(pluginsDir, plugin, "agents");
      let fileNames: string[];
      try {
        fileNames = await fs.readdir(agentsDir);
      } catch {
        continue; // plugin without agents/
      }
      fileNames.sort();
      for (const fileName of fileNames) {
        if (!fileName.endsWith(".md")) continue;
        const fullPath = path.join(agentsDir, fileName);
        let text: string;
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isFile()) continue;
          text = await fs.readFile(fullPath, "utf8");
        } catch {
          continue;
        }
        const fm = parseFrontmatter(text);
        if (fm === null) continue;

        const stem = path.basename(fileName, ".md");
        let name = typeof fm["name"] === "string" ? (fm["name"] as string).trim() : "";
        if (!name) name = `${plugin}-${stem}`;
        if (agents.has(name)) continue;

        const description = flattenDescription(fm["description"]);
        const modelRaw = fm["model"];
        const model =
          typeof modelRaw === "string" && modelRaw.trim() && modelRaw.trim() !== "inherit"
            ? modelRaw.trim()
            : undefined;

        const agent: ScannedAgent = {
          name,
          description,
          file: path.relative(root, fullPath),
          plugin,
          classifyName: stem,
          tools: normalizeTools(fm["tools"]),
          hasDescription: description.length > 0,
        };
        if (model !== undefined) agent.model = model;
        agents.set(name, agent);
      }
    }
  }
}

/**
 * Scan category-flat agent repos: `<root>/<category>/*.md`, no nested `agents/` folder and no
 * per-category toolkit (unlike the wshobson marketplace layout). E.g. awesome-claude-code-subagents
 * (`categories/<NN-name>/*.md`) and agency-agents (`<domain>/*.md`).
 *
 * Map key is always the file stem, never the frontmatter `name` — these repos' frontmatter
 * names are inconsistent (kebab-case matching the stem in one repo, free-text display labels
 * like "Software Architect" that collide across categories in another), while filenames are
 * the actually-unique identifiers.
 */
async function scanCategoryRoots(roots: string[], agents: Map<string, ScannedAgent>): Promise<void> {
  for (const root of roots) {
    let categoryNames: string[];
    try {
      categoryNames = await fs.readdir(root);
    } catch {
      continue;
    }
    categoryNames.sort();
    for (const category of categoryNames) {
      if (category.startsWith(".")) continue;
      const categoryDir = path.join(root, category);
      try {
        if (!(await fs.stat(categoryDir)).isDirectory()) continue;
      } catch {
        continue;
      }

      let fileNames: string[];
      try {
        fileNames = await fs.readdir(categoryDir);
      } catch {
        continue;
      }
      fileNames.sort();
      for (const fileName of fileNames) {
        if (!fileName.endsWith(".md")) continue;
        const fullPath = path.join(categoryDir, fileName);
        let text: string;
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isFile()) continue;
          text = await fs.readFile(fullPath, "utf8");
        } catch {
          continue;
        }
        const fm = parseFrontmatter(text);
        if (fm === null) continue; // e.g. category README.md — no frontmatter, skipped naturally

        const stem = path.basename(fileName, ".md");
        if (agents.has(stem)) continue;

        const description = flattenDescription(fm["description"]);
        const modelRaw = fm["model"];
        const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;

        const agent: ScannedAgent = {
          name: stem,
          description,
          file: path.relative(root, fullPath),
          classifyName: stem,
          tools: normalizeTools(fm["tools"]),
          hasDescription: description.length > 0,
        };
        if (model !== undefined) agent.model = model;
        agents.set(stem, agent);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Toolkit scanning (plugin skills/ + commands/, keyed by plugin — not domain)
// ---------------------------------------------------------------------------

interface ToolkitEntry {
  name: string;
  description: string;
  file: string;
}

interface PluginToolkitData {
  skills: ToolkitEntry[];
  commands: ToolkitEntry[];
}

async function scanSkillDirs(skillsDir: string, root: string): Promise<ToolkitEntry[]> {
  let dirNames: string[];
  try {
    dirNames = await fs.readdir(skillsDir);
  } catch {
    return [];
  }
  dirNames.sort();
  const entries: ToolkitEntry[] = [];
  for (const dirName of dirNames) {
    const skillFile = path.join(skillsDir, dirName, "SKILL.md");
    let text: string;
    try {
      const stat = await fs.stat(skillFile);
      if (!stat.isFile()) continue;
      text = await fs.readFile(skillFile, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (fm === null) continue;
    const name = (typeof fm["name"] === "string" && fm["name"].trim()) || dirName;
    entries.push({ name, description: flattenDescription(fm["description"]), file: path.relative(root, skillFile) });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

async function scanCommandFiles(commandsDir: string, root: string): Promise<ToolkitEntry[]> {
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(commandsDir);
  } catch {
    return [];
  }
  fileNames.sort();
  const entries: ToolkitEntry[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".md")) continue;
    const fullPath = path.join(commandsDir, fileName);
    let text: string;
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;
      text = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (fm === null) continue;
    // Commands have no frontmatter `name` — the slash-command name IS the file stem.
    const stem = path.basename(fileName, ".md");
    entries.push({ name: stem, description: flattenDescription(fm["description"]), file: path.relative(root, fullPath) });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

/**
 * Index each marketplace root's plugins/<plugin>/{skills,commands}/ once per plugin, regardless
 * of how many domains that plugin's agents land in. Safe to pass category-flat roots too — a
 * missing plugins/ dir just yields nothing (try/catch), so this can reuse the same root union
 * the agent-reconciliation pass uses without needing a separate plugin-vs-category root registry.
 * Same installed-only filter as `scanPluginRoots` — an uninstalled plugin's skills/commands
 * aren't reachable at spawn time, so indexing them is dead weight.
 */
async function scanToolkits(roots: string[]): Promise<Map<string, PluginToolkitData>> {
  const installed = await loadInstalledPluginKeys();
  const known = await loadKnownMarketplaces();
  const toolkits = new Map<string, PluginToolkitData>();
  for (const root of roots) {
    const pluginsDir = path.join(root, "plugins");
    let pluginNames: string[];
    try {
      pluginNames = await fs.readdir(pluginsDir);
    } catch {
      continue;
    }
    pluginNames.sort();
    const marketplace = resolveMarketplaceName(root, known);
    for (const plugin of pluginNames) {
      if (installed !== null && marketplace !== null && !installed.has(`${plugin}@${marketplace}`)) continue;
      if (toolkits.has(plugin)) continue; // first root wins, same collision rule as agents
      const skills = await scanSkillDirs(path.join(pluginsDir, plugin, "skills"), root);
      const commands = await scanCommandFiles(path.join(pluginsDir, plugin, "commands"), root);
      if (skills.length > 0 || commands.length > 0) toolkits.set(plugin, { skills, commands });
    }
  }
  return toolkits;
}

function serializeToolkits(toolkits: Map<string, PluginToolkitData>): string {
  const out: Record<string, PluginToolkitData> = {};
  for (const plugin of [...toolkits.keys()].sort()) {
    const data = toolkits.get(plugin);
    if (data) out[plugin] = data;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Existing map loading
// ---------------------------------------------------------------------------

async function loadExisting(outDir: string): Promise<ExistingMap | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(outDir, "index.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const domainsRaw = (parsed as Record<string, unknown>)["domains"];
  if (typeof domainsRaw !== "object" || domainsRaw === null) return null;
  const rootsRaw = (parsed as Record<string, unknown>)["roots"];
  const roots = Array.isArray(rootsRaw) ? rootsRaw.filter((r): r is string => typeof r === "string") : [];

  const assignments = new Map<string, string>();
  const entries = new Map<string, PieceEntry>();
  const domains: string[] = [];

  for (const [domain, names] of Object.entries(domainsRaw as Record<string, unknown>)) {
    if (!Array.isArray(names)) continue;
    domains.push(domain);
    for (const n of names) {
      if (typeof n === "string" && !assignments.has(n)) assignments.set(n, domain);
    }
    // Load the piece file for entry details (description/file/model).
    let piece: unknown;
    try {
      piece = JSON.parse(await fs.readFile(path.join(outDir, `${domain}.json`), "utf8"));
    } catch {
      continue; // missing/corrupt piece — entries rebuilt from scan
    }
    if (!Array.isArray(piece)) continue;
    for (const e of piece) {
      if (typeof e !== "object" || e === null) continue;
      const entry = e as PieceEntry;
      if (typeof entry.name !== "string" || entries.has(entry.name)) continue;
      // Never store tools in pieces — strip if a legacy write left one behind.
      const { tools: _tools, ...rest } = entry as PieceEntry & { tools?: unknown };
      entries.set(entry.name, rest as PieceEntry);
    }
  }
  return { assignments, entries, domains, roots };
}

/** Does a piece entry's file still exist? Absolute paths are checked directly; relative paths
 * are tried against each known root (same resolution order hydrate.ts uses). */
async function fileStillExists(file: string, roots: string[]): Promise<boolean> {
  if (path.isAbsolute(file)) {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }
  for (const root of roots) {
    try {
      await fs.access(path.join(root, file));
      return true;
    } catch {
      /* try next root */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Merge + serialize
// ---------------------------------------------------------------------------

interface MergeResult {
  buckets: Map<string, PieceEntry[]>;
  newAgents: { name: string; domain: string }[];
  dropped: string[];
  noDescription: string[];
  keptCount: number;
  previousDomains: string[];
}

function makeEntry(scanned: ScannedAgent): PieceEntry {
  const entry: PieceEntry = {
    name: scanned.name,
    description: scanned.description,
    file: scanned.file,
  };
  if (scanned.plugin !== undefined) entry["plugin"] = scanned.plugin;
  if (scanned.model !== undefined) entry.model = scanned.model;
  return entry;
}

/**
 * Fold a ported-taxonomy domain into the existing map's taxonomy.
 * A map built by other means (e.g. an LLM taxonomy) may use richer names like
 * "engineering-backend" where the ported classifier says "backend"; without
 * this, every recognizable new agent would create a stray sibling domain.
 * Aliases only when exactly ONE existing domain matches: exact name, or the
 * ported name as a hyphen-bounded segment (backend -> engineering-backend,
 * ml -> engineering-ai-ml, testing -> testing-qa). Ambiguous or no match ->
 * keep the classifier's domain.
 */
function resolveDomainAlias(domain: string, existingDomains: string[]): string {
  if (domain === "unmapped" || existingDomains.length === 0) return domain;
  if (existingDomains.includes(domain)) return domain;
  const matches = existingDomains.filter(
    (d) =>
      d.startsWith(`${domain}-`) || d.endsWith(`-${domain}`) || d.includes(`-${domain}-`),
  );
  const only = matches[0];
  return matches.length === 1 && only !== undefined ? only : domain;
}

function merge(scanned: Map<string, ScannedAgent>, existing: ExistingMap | null): MergeResult {
  const buckets = new Map<string, PieceEntry[]>();
  const newAgents: { name: string; domain: string }[] = [];
  const dropped: string[] = [];
  const noDescription: string[] = [];
  let keptCount = 0;

  const push = (domain: string, entry: PieceEntry): void => {
    const bucket = buckets.get(domain);
    if (bucket) bucket.push(entry);
    else buckets.set(domain, [entry]);
  };

  // 1. Existing assignments are authoritative — keep, or drop if source vanished.
  if (existing) {
    for (const [name, domain] of existing.assignments) {
      const source = scanned.get(name);
      if (!source) {
        dropped.push(name);
        continue;
      }
      push(domain, existing.entries.get(name) ?? makeEntry(source));
      keptCount++;
    }
  }

  // 2. Classify only agents not already present.
  for (const [name, source] of scanned) {
    if (existing?.assignments.has(name)) continue;
    if (!source.hasDescription) {
      noDescription.push(name); // skipped from map, reported as unmapped
      continue;
    }
    const { domain: classified } = classify(source.classifyName, source.description);
    const domain = resolveDomainAlias(classified, existing?.domains ?? []);
    push(domain, makeEntry(source));
    newAgents.push({ name, domain });
  }

  // 3. Deterministic ordering.
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  dropped.sort();
  noDescription.sort();
  newAgents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    buckets,
    newAgents,
    dropped,
    noDescription,
    keptCount,
    previousDomains: existing?.domains ?? [],
  };
}

function serializeIndex(buckets: Map<string, PieceEntry[]>, roots: string[]): string {
  const domains: Record<string, string[]> = {};
  for (const domain of [...buckets.keys()].sort()) {
    const bucket = buckets.get(domain);
    if (bucket) domains[domain] = bucket.map((e) => e.name);
  }
  const out: Record<string, unknown> = { version: MAP_VERSION };
  // Persona fetch resolves any entry's relative `file` path against these roots — plugin-root
  // entries also fetch their plugin's skills/ + commands/ from the same root.
  if (roots.length > 0) out["roots"] = [...new Set(roots.map((r) => path.resolve(r)))].sort();
  out["domains"] = domains;
  return JSON.stringify(out, null, 2) + "\n";
}

function serializePiece(entries: PieceEntry[]): string {
  return JSON.stringify(entries, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Write only when content differs. Returns true when the file changed. */
async function writeIfChanged(filePath: string, content: string, check: boolean): Promise<boolean> {
  const current = await readIfExists(filePath);
  if (current === content) return false;
  if (!check) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runScan(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const dirs = [...(opts.noDefaults ? [] : defaultScanDirs()), ...opts.extraDirs];

  const scanned = new Map<string, ScannedAgent>();
  const excludedPluginKeys = new Set<string>(); // "<plugin>@<marketplace>" filtered out as not-installed
  await scanPluginRoots(opts.pluginRoots, scanned, excludedPluginKeys); // plugin + category roots win name collisions
  await scanCategoryRoots(opts.categoryRoots, scanned);
  await scanDirs(dirs, scanned);
  const existing = await loadExisting(opts.outDir);
  const allRoots = [...new Set([...opts.pluginRoots, ...opts.categoryRoots, ...(existing?.roots ?? [])])];

  // An existing entry not covered by this run's scan (e.g. a `bootstrap()` re-scan that only
  // passes --plugins, not every --categories flag ever used) is dropped only if its file has
  // genuinely vanished — never merely because this invocation didn't repeat every historical
  // root flag. Revive it into `scanned` so merge()'s existing-assignment check keeps it; the
  // piece entry (not this placeholder) still supplies its description/file/model/plugin.
  //
  // Exception: an entry whose plugin was filtered out this run as not-installed (present in
  // excludedPluginKeys) is never revived, even though its source .md file still physically
  // exists in the marketplace checkout — uninstalling a plugin doesn't delete the marketplace's
  // copy of it. Skipping revival here routes it through merge()'s normal "source vanished" path
  // so it surfaces in the `dropped` report instead of lingering in the map forever.
  if (existing) {
    const known = await loadKnownMarketplaces();
    for (const name of existing.assignments.keys()) {
      if (scanned.has(name)) continue;
      const entry = existing.entries.get(name);
      if (!entry) continue;
      const entryPlugin = entry.plugin;
      if (
        typeof entryPlugin === "string" &&
        opts.pluginRoots.some((root) => {
          const marketplace = resolveMarketplaceName(root, known);
          return marketplace !== null && excludedPluginKeys.has(`${entryPlugin}@${marketplace}`);
        })
      ) {
        continue;
      }
      if (!(await fileStillExists(entry.file, allRoots))) continue;
      const revived: ScannedAgent = {
        name,
        description: entry.description,
        file: entry.file,
        classifyName: name,
        tools: [],
        hasDescription: entry.description.length > 0,
      };
      if (typeof entry.plugin === "string") revived.plugin = entry.plugin;
      if (entry.model !== undefined) revived.model = entry.model;
      scanned.set(name, revived);
    }
  }

  const result = merge(scanned, existing);

  const changedFiles: string[] = [];
  const staleRemoved: string[] = [];

  // index.json
  if (
    await writeIfChanged(
      path.join(opts.outDir, "index.json"),
      serializeIndex(result.buckets, allRoots),
      opts.check,
    )
  ) {
    changedFiles.push("index.json");
  }

  // pieces
  for (const domain of [...result.buckets.keys()].sort()) {
    const bucket = result.buckets.get(domain);
    if (!bucket) continue;
    const pieceFile = `${domain}.json`;
    if (await writeIfChanged(path.join(opts.outDir, pieceFile), serializePiece(bucket), opts.check)) {
      changedFiles.push(pieceFile);
    }
  }

  // toolkits.json (plugin skills/ + commands/, keyed by plugin)
  const toolkits = await scanToolkits(allRoots);
  if (await writeIfChanged(path.join(opts.outDir, "toolkits.json"), serializeToolkits(toolkits), opts.check)) {
    changedFiles.push("toolkits.json");
  }

  // stale pieces (domain emptied out entirely)
  for (const domain of result.previousDomains) {
    if (result.buckets.has(domain)) continue;
    const piecePath = path.join(opts.outDir, `${domain}.json`);
    if ((await readIfExists(piecePath)) === null) continue;
    if (!opts.check) await fs.unlink(piecePath);
    staleRemoved.push(`${domain}.json`);
  }

  // ------------------------------------------------------------------------
  // Report
  // ------------------------------------------------------------------------
  const agentCount = [...result.buckets.values()].reduce((n, b) => n + b.length, 0);
  const unmappedBucket = result.buckets.get("unmapped") ?? [];
  const unmapped = [
    ...unmappedBucket.map((e) => e.name),
    ...result.noDescription.map((n) => `${n} (no description)`),
  ];

  const lines: string[] = [];
  lines.push(`map:      ${opts.outDir}`);
  lines.push(`domains:  ${result.buckets.size}`);
  lines.push(`agents:   ${agentCount} (${result.keptCount} existing kept, ${result.newAgents.length} new)`);
  lines.push(`new (${result.newAgents.length}):`);
  for (const a of result.newAgents) lines.push(`  ${a.name} -> ${a.domain}`);
  lines.push(`dropped (${result.dropped.length}):`);
  for (const name of result.dropped) lines.push(`  ${name}`);
  lines.push(`unmapped (${unmapped.length}):`);
  for (const name of unmapped) lines.push(`  ${name}`);
  if (staleRemoved.length > 0) {
    lines.push(`stale pieces removed (${staleRemoved.length}): ${staleRemoved.join(", ")}`);
  }
  if (opts.check) {
    lines.push(
      changedFiles.length > 0
        ? `[check] dry run — would write: ${changedFiles.join(", ")}`
        : "[check] dry run — no changes",
    );
  } else {
    lines.push(
      changedFiles.length > 0 ? `wrote: ${changedFiles.join(", ")}` : "no changes (map up to date)",
    );
  }
  console.log(lines.join("\n"));
}
