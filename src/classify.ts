/**
 * classify.ts — deterministic domain classification.
 * Port of `_classify` (agent_map.py) and `_collect_matches` (domains.py).
 *
 * Priority chain (faithful to the Python reference):
 *   1. exact name match in ROLE_DOMAIN            → source "name"
 *   2. description keyword match (collectMatches) → source "description"
 *   3. fallback                                   → domain "unmapped"
 *
 * Also the engine behind `promper classify "<text>"` — the task-text → domain breakdown
 * primitive the breakdown skill calls per node. Same trigger tables, zero LLM.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CATEGORY_PRIORITY, REGISTRY, ROLE_DOMAIN } from "./domains.js";

export type ClassifySource = "name" | "description" | "unmapped";

export interface Classification {
  domain: string;
  source: ClassifySource;
}

interface Match {
  role: string;
  category: string;
  trigger: string;
  priority: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Port of `_collect_matches`: scan registry triggers against the lowercased
 * text with word-boundary matching; one match per agent; stable-sorted by
 * category priority.
 */
export function collectMatches(text: string): Match[] {
  const t = text.toLowerCase();
  const matches: Match[] = [];
  for (const agent of REGISTRY) {
    if (agent.orchestrate) continue;
    for (const trigger of agent.triggers) {
      const re = new RegExp(`\\b${escapeRegExp(trigger)}\\b`);
      if (re.test(t)) {
        matches.push({
          role: agent.id,
          category: agent.category,
          trigger,
          priority: CATEGORY_PRIORITY[agent.category] ?? 99,
        });
        break;
      }
    }
  }
  // Array.prototype.sort is stable, matching Python's list.sort.
  matches.sort((a, b) => a.priority - b.priority);
  return matches;
}

/** Port of `_classify` — see priority chain above. */
export function classify(name: string, description: string): Classification {
  // Priority 1 — name match (certain, cheap)
  const byName = ROLE_DOMAIN[name];
  if (byName !== undefined) return { domain: byName, source: "name" };

  // Priority 2 — description keyword classification
  if (description) {
    const matches = collectMatches(description);
    if (matches.length > 0) {
      const first = matches[0];
      if (first !== undefined) {
        const domain = ROLE_DOMAIN[first.role];
        if (domain !== undefined) return { domain, source: "description" };
      }
    }
  }

  // Priority 3 — unmapped
  return { domain: "unmapped", source: "unmapped" };
}

// ---------------------------------------------------------------------------
// `promper classify` CLI — deterministic task-text → domain breakdown.
// ---------------------------------------------------------------------------

export interface SuggestedAgent {
  name: string;
  inMap: boolean;
}

export interface DomainMatch {
  domain: string;
  priority: number;
  triggers: string[];
  roles: string[];
  suggestedAgents: SuggestedAgent[];
}

export interface ClassifyResult {
  text: string;
  primary: string;
  unmapped: boolean;
  matches: DomainMatch[];
}

/** Names present in a lean-map domain piece; empty set when the piece is missing/unreadable. */
async function mapNames(mapDir: string, domain: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(join(mapDir, `${domain}.json`), "utf8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return new Set();
    return new Set(entries.map((e) => (typeof e?.name === "string" ? e.name : "")).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Group `collectMatches` hits by domain (via ROLE_DOMAIN), rank domains by their best
 * category priority, and flag which suggested agents exist in the lean map. Deterministic:
 * same text + same map contents → same output.
 */
export async function classifyText(text: string, mapDir: string, top: number | null): Promise<ClassifyResult> {
  const byDomain = new Map<string, { priority: number; triggers: string[]; roles: string[] }>();
  for (const match of collectMatches(text)) {
    const domain = ROLE_DOMAIN[match.role];
    if (domain === undefined) continue; // registry row without a domain — same skip as classify()
    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { priority: match.priority, triggers: [], roles: [] };
      byDomain.set(domain, entry);
    }
    entry.priority = Math.min(entry.priority, match.priority);
    if (!entry.triggers.includes(match.trigger)) entry.triggers.push(match.trigger);
    if (!entry.roles.includes(match.role)) entry.roles.push(match.role);
  }

  // Map insertion order preserves collectMatches's stable priority sort for equal priorities.
  let ranked = [...byDomain.entries()].sort((a, b) => a[1].priority - b[1].priority);
  if (top !== null && top > 0) ranked = ranked.slice(0, top);

  const matches: DomainMatch[] = [];
  for (const [domain, entry] of ranked) {
    const names = await mapNames(mapDir, domain);
    matches.push({
      domain,
      priority: entry.priority,
      triggers: entry.triggers,
      roles: entry.roles,
      suggestedAgents: entry.roles.map((name) => ({ name, inMap: names.has(name) })),
    });
  }

  const first = matches[0];
  return {
    text,
    primary: first !== undefined ? first.domain : "unmapped",
    unmapped: first === undefined,
    matches,
  };
}

interface ClassifyOptions {
  text: string;
  mapDir: string;
  top: number | null;
  json: boolean;
}

function parseClassifyArgs(argv: string[]): ClassifyOptions {
  const positional: string[] = [];
  const opts: ClassifyOptions = {
    text: "",
    mapDir: join(homedir(), ".invoker", "map"),
    top: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--map": {
        const value = argv[++i];
        if (!value) throw new Error("--map requires a directory");
        opts.mapDir = value;
        break;
      }
      case "--top": {
        const value = argv[++i];
        if (!value) throw new Error("--top requires a number");
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new Error("--top must be a positive integer");
        opts.top = n;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
        positional.push(arg);
    }
  }
  opts.text = positional.join(" ");
  return opts;
}

export async function runClassify(argv: string[]): Promise<void> {
  const opts = parseClassifyArgs(argv);
  if (!opts.text.trim()) throw new Error('usage: promper classify "<text>" [--json] [--map <dir>] [--top <n>]');
  const result = await classifyText(opts.text, opts.mapDir, opts.top);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.unmapped) {
    console.log("unmapped — no domain triggers matched");
    return;
  }
  for (const match of result.matches) {
    const agents = match.suggestedAgents
      .map((agent) => `${agent.name}${agent.inMap ? "" : " (not in map)"}`)
      .join(", ");
    console.log(`${match.domain}  ←  ${match.triggers.join(", ")}  →  ${agents}`);
  }
}
