/**
 * scan.ts — `promper scan`: deterministically build promper's lean routing map.
 *
 * Output layout (default ~/.invoker/map/):
 *   index.json     { "version": 1, "domains": { "<domain>": ["<agent-name>", ...] } }
 *   <domain>.json  [ { "name", "description", "file", "model"? }, ... ]
 *
 * Zero LLM. Ported from invokerai/agent_invoker/agent_map.py + domains.py.
 *
 * Merge rules:
 *   - Existing agent→domain assignments in index.json are authoritative:
 *     agents are never moved between domains and domains are never renamed.
 *   - Only agents not already present are classified (ported taxonomy).
 *   - Agents whose source file vanished are dropped and reported.
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
  tools: string[];
  hasDescription: boolean;
}

interface ScanOptions {
  extraDirs: string[];
  check: boolean;
  legacy: boolean;
  outDir: string;
}

interface ExistingMap {
  /** agent name → domain (first occurrence wins) */
  assignments: Map<string, string>;
  /** agent name → piece entry as previously written */
  entries: Map<string, PieceEntry>;
  /** previous domain list (for stale-piece cleanup) */
  domains: string[];
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ScanOptions {
  const opts: ScanOptions = {
    extraDirs: [],
    check: false,
    legacy: false,
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
      case "--out": {
        const value = argv[++i];
        if (!value) throw new Error("--out requires a path");
        opts.outDir = value;
        break;
      }
      case "--check":
        opts.check = true;
        break;
      case "--legacy":
        opts.legacy = true;
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
async function scanDirs(dirs: string[]): Promise<Map<string, ScannedAgent>> {
  const agents = new Map<string, ScannedAgent>();
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
        tools: normalizeTools(fm["tools"]),
        hasDescription: description.length > 0,
      };
      if (model !== undefined) agent.model = model;
      agents.set(name, agent);
    }
  }
  return agents;
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
  return { assignments, entries, domains };
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
  if (scanned.model !== undefined) entry.model = scanned.model;
  return entry;
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
    const { domain } = classify(name, source.description);
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

function serializeIndex(buckets: Map<string, PieceEntry[]>): string {
  const domains: Record<string, string[]> = {};
  for (const domain of [...buckets.keys()].sort()) {
    const bucket = buckets.get(domain);
    if (bucket) domains[domain] = bucket.map((e) => e.name);
  }
  return JSON.stringify({ version: MAP_VERSION, domains }, null, 2) + "\n";
}

function serializePiece(entries: PieceEntry[]): string {
  return JSON.stringify(entries, null, 2) + "\n";
}

function serializeLegacy(
  buckets: Map<string, PieceEntry[]>,
  scanned: Map<string, ScannedAgent>,
): string {
  const domains: Record<string, Record<string, unknown>[]> = {};
  for (const domain of [...buckets.keys()].sort()) {
    const bucket = buckets.get(domain);
    if (!bucket) continue;
    domains[domain] = bucket.map((e) => {
      const source = scanned.get(e.name);
      const legacy: Record<string, unknown> = {
        name: e.name,
        file: e.file,
        description: e.description,
      };
      if (source && source.tools.length > 0) legacy["tools"] = source.tools;
      const model = e.model ?? source?.model;
      if (model !== undefined) legacy["model"] = model;
      return legacy;
    });
  }
  return JSON.stringify({ version: MAP_VERSION, domains }, null, 2) + "\n";
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
  const dirs = [...defaultScanDirs(), ...opts.extraDirs];

  const scanned = await scanDirs(dirs);
  const existing = await loadExisting(opts.outDir);
  const result = merge(scanned, existing);

  const changedFiles: string[] = [];
  const staleRemoved: string[] = [];

  // index.json
  if (await writeIfChanged(path.join(opts.outDir, "index.json"), serializeIndex(result.buckets), opts.check)) {
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

  // stale pieces (domain emptied out entirely)
  for (const domain of result.previousDomains) {
    if (result.buckets.has(domain)) continue;
    const piecePath = path.join(opts.outDir, `${domain}.json`);
    if ((await readIfExists(piecePath)) === null) continue;
    if (!opts.check) await fs.unlink(piecePath);
    staleRemoved.push(`${domain}.json`);
  }

  // legacy map
  if (opts.legacy) {
    const legacyPath = path.join(homedir(), ".invoker", "agent-map.json");
    if (await writeIfChanged(legacyPath, serializeLegacy(result.buckets, scanned), opts.check)) {
      changedFiles.push(legacyPath);
    }
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
