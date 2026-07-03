/**
 * agents-cli.ts — `promper tools`: manage the agent roster's frontmatter.
 *
 * Phase 0: ensure every agent carries the Caveman Ultra `initialPrompt:` block
 *          (idempotent — inserted once, never rewritten).
 * Phase 1: pick tools applied to ALL agents.
 * Phase 2: per-tool individual assignment — pick a tool, pick the agents.
 *
 * Editing is line surgery inside the leading `---` frontmatter block so the
 * hand-written formatting of each agent file is preserved; every write is
 * validated by re-parsing the frontmatter with js-yaml.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

import { parseFrontmatter, normalizeTools } from "./frontmatter.js";

export const CAVEMAN_ULTRA =
  "# Style: caveman ultra. Prose/chat: drop articles, filler, hedging. Fragments OK. " +
  "Abbreviate (DB/auth/config/req/res/fn). X->Y for causality. Technical terms and identifiers exact. " +
  "Code, commits, PR bodies, and shipped deliverables (docs, copy, reports, customer-facing drafts): " +
  "normal professional English. Break character for security warnings and irreversible ops.";

const BUILTIN_TOOLS = [
  "All tools",
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Agent",
  "Skill",
  "NotebookEdit",
  "TaskCreate",
];

interface AgentFile {
  name: string;
  filePath: string;
  tools: string[];
  hasInitialPrompt: boolean;
}

interface ToolsOptions {
  dir: string | null;
  check: boolean;
  cavemanOnly: boolean;
  all: string[];
  picks: Map<string, string[]>; // tool -> agent names
  interactive: boolean;
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ToolsOptions {
  const opts: ToolsOptions = {
    dir: null,
    check: false,
    cavemanOnly: false,
    all: [],
    picks: new Map(),
    interactive: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir": {
        const value = argv[++i];
        if (!value) throw new Error("--dir requires a path");
        opts.dir = value;
        break;
      }
      case "--check":
        opts.check = true;
        break;
      case "--caveman-only":
        opts.cavemanOnly = true;
        opts.interactive = false;
        break;
      case "--all": {
        const value = argv[++i];
        if (!value) throw new Error('--all requires a csv list, e.g. --all "Read,Bash"');
        opts.all.push(...value.split(",").map((t) => t.trim()).filter(Boolean));
        opts.interactive = false;
        break;
      }
      case "--pick": {
        const value = argv[++i];
        if (!value || !value.includes(":")) {
          throw new Error('--pick requires "<tool>:<agent,agent,...>"');
        }
        const sep = value.indexOf(":");
        const tool = value.slice(0, sep).trim();
        const agents = value.slice(sep + 1).split(",").map((a) => a.trim()).filter(Boolean);
        if (!tool || agents.length === 0) throw new Error('--pick requires "<tool>:<agent,...>"');
        const existing = opts.picks.get(tool) ?? [];
        opts.picks.set(tool, [...existing, ...agents]);
        opts.interactive = false;
        break;
      }
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  return opts;
}

async function resolveDir(dirOpt: string | null): Promise<string> {
  if (dirOpt) return path.resolve(dirOpt);
  const local = path.resolve(process.cwd(), "agents");
  try {
    const stat = await fs.stat(local);
    if (stat.isDirectory()) return local;
  } catch {
    /* fall through */
  }
  return path.join(homedir(), ".claude", "agents");
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadAgents(dir: string): Promise<AgentFile[]> {
  let fileNames: string[];
  try {
    fileNames = await fs.readdir(dir);
  } catch {
    throw new Error(`agents directory not found: ${dir}`);
  }
  fileNames.sort();
  const agents: AgentFile[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(dir, fileName);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (fm === null) continue;
    const nameRaw = fm["name"];
    const name =
      typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : path.basename(fileName, ".md");
    agents.push({
      name,
      filePath,
      tools: normalizeTools(fm["tools"]),
      hasInitialPrompt: typeof fm["initialPrompt"] === "string" && (fm["initialPrompt"] as string).trim().length > 0,
    });
  }
  if (agents.length === 0) throw new Error(`no agent .md files with frontmatter in ${dir}`);
  return agents;
}

// ---------------------------------------------------------------------------
// Frontmatter line surgery
// ---------------------------------------------------------------------------

interface FrontmatterBounds {
  lines: string[];
  closeIdx: number; // index of the closing --- line
}

function frontmatterBounds(text: string): FrontmatterBounds | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return { lines, closeIdx: i };
  }
  return null;
}

/** Remove a top-level frontmatter field and its indented continuation lines. */
function removeField(bounds: FrontmatterBounds, field: string): void {
  const { lines } = bounds;
  for (let i = 1; i < bounds.closeIdx; i++) {
    const line = lines[i];
    if (line === undefined || !line.startsWith(`${field}:`)) continue;
    let end = i + 1;
    while (end < bounds.closeIdx) {
      const cont = lines[end];
      if (cont !== undefined && (cont.startsWith("  ") || cont.startsWith("\t") || cont.trim() === "")) end++;
      else break;
    }
    lines.splice(i, end - i);
    bounds.closeIdx -= end - i;
    return;
  }
}

/** Insert raw frontmatter lines just before the closing ---. */
function insertBeforeClose(bounds: FrontmatterBounds, newLines: string[]): void {
  bounds.lines.splice(bounds.closeIdx, 0, ...newLines);
  bounds.closeIdx += newLines.length;
}

// Single line, double-quoted: an unquoted value starting with "#" is a YAML
// comment and the field silently parses as null.
function initialPromptLines(): string[] {
  return [`initialPrompt: ${JSON.stringify(CAVEMAN_ULTRA)}`];
}

async function editAgentFile(
  filePath: string,
  edit: (bounds: FrontmatterBounds) => void,
  check: boolean,
): Promise<boolean> {
  const original = await fs.readFile(filePath, "utf8");
  const bounds = frontmatterBounds(original);
  if (!bounds) return false;
  edit(bounds);
  const updated = bounds.lines.join("\n");
  if (updated === original) return false;
  if (parseFrontmatter(updated) === null) {
    throw new Error(`edit would corrupt frontmatter: ${filePath}`);
  }
  if (!check) await fs.writeFile(filePath, updated, "utf8");
  return true;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function ensureInitialPrompt(agents: AgentFile[], check: boolean): Promise<string[]> {
  const changed: string[] = [];
  for (const agent of agents) {
    if (agent.hasInitialPrompt) continue;
    const did = await editAgentFile(
      agent.filePath,
      (bounds) => {
        removeField(bounds, "initialPrompt");
        insertBeforeClose(bounds, initialPromptLines());
      },
      check,
    );
    if (did) changed.push(agent.name);
  }
  return changed;
}

async function discoverTools(dirs: string[]): Promise<string[]> {
  const found = new Set<string>(BUILTIN_TOOLS);
  for (const dir of dirs) {
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (!fileName.endsWith(".md")) continue;
      try {
        const fm = parseFrontmatter(await fs.readFile(path.join(dir, fileName), "utf8"));
        if (fm) for (const t of normalizeTools(fm["tools"])) found.add(t);
      } catch {
        continue;
      }
    }
  }
  const rest = [...found].filter((t) => t !== "All tools").sort();
  return ["All tools", ...rest];
}

function mergedTools(existing: string[], additions: string[]): string[] {
  const merged = new Set([...existing, ...additions]);
  if (merged.has("All tools")) return ["All tools"];
  return [...merged].sort();
}

export async function applyTools(
  agents: AgentFile[],
  globalTools: string[],
  picks: Map<string, string[]>,
  check: boolean,
): Promise<Map<string, string[]>> {
  const perAgent = new Map<string, string[]>();
  for (const agent of agents) {
    const individual: string[] = [];
    for (const [tool, names] of picks) {
      if (names.includes(agent.name)) individual.push(tool);
    }
    const additions = [...globalTools, ...individual];
    if (additions.length === 0) continue;
    const merged = mergedTools(agent.tools, additions);
    if (merged.length === agent.tools.length && merged.every((t, i) => agent.tools[i] === t)) continue;
    const did = await editAgentFile(
      agent.filePath,
      (bounds) => {
        removeField(bounds, "tools");
        insertBeforeClose(bounds, [`tools: ${merged.join(", ")}`]);
      },
      check,
    );
    if (did) perAgent.set(agent.name, merged);
  }
  return perAgent;
}

// ---------------------------------------------------------------------------
// Interactive selection
// ---------------------------------------------------------------------------

/** Parse "1,3,5-7" | "all" | "" against a 1-based list length. */
export function parseSelection(input: string, count: number): number[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return [];
  if (trimmed === "all") return Array.from({ length: count }, (_, i) => i);
  const picked = new Set<number>();
  for (const token of trimmed.split(",")) {
    const t = token.trim();
    if (!t) continue;
    const range = t.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let n = lo; n <= hi; n++) if (n >= 1 && n <= count) picked.add(n - 1);
      continue;
    }
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= count) picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

function printNumbered(items: string[]): void {
  const width = String(items.length).length;
  items.forEach((item, i) => console.log(`  ${String(i + 1).padStart(width)}. ${item}`));
}

/**
 * Buffered line asker. With piped stdin, readline emits every line as soon as
 * the chunk arrives — a pending question() only captures the next one and the
 * rest are dropped. Queue all lines; ask() pops the queue or waits; EOF
 * resolves pending/future asks with "" (skip/done).
 */
function createAsker(): { ask: (q: string) => Promise<string>; close: () => void } {
  const queued: string[] = [];
  const waiters: Array<(s: string) => void> = [];
  let closed = false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queued.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length > 0) waiters.shift()?.("");
  });
  const ask = (q: string): Promise<string> => {
    process.stdout.write(q);
    const line = queued.shift();
    if (line !== undefined) {
      process.stdout.write(`${line}\n`);
      return Promise.resolve(line);
    }
    if (closed) {
      process.stdout.write("\n");
      return Promise.resolve("");
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  return { ask, close: () => rl.close() };
}

async function interactiveFlow(
  agents: AgentFile[],
  tools: string[],
): Promise<{ globalTools: string[]; picks: Map<string, string[]> }> {
  const { ask, close } = createAsker();
  try {
    console.log("\nAvailable tools:");
    printNumbered(tools);
    const globalInput = await ask("\nApply to ALL agents (e.g. 1,3,5-7 / all / empty=skip): ");
    const globalTools = parseSelection(globalInput, tools.length)
      .map((i) => tools[i])
      .filter((t): t is string => t !== undefined);

    const picks = new Map<string, string[]>();
    for (;;) {
      const toolInput = await ask("\nTool # for individual assignment (empty=done): ");
      if (toolInput.trim() === "") break;
      const toolIdx = parseSelection(toolInput, tools.length);
      const first = toolIdx[0];
      const tool = first !== undefined ? tools[first] : undefined;
      if (tool === undefined) {
        console.log("  no such tool number");
        continue;
      }
      console.log(`\nAgents (assigning: ${tool}):`);
      printNumbered(agents.map((a) => a.name));
      const agentInput = await ask(`Agents for ${tool} (e.g. 2,4 / all / empty=skip): `);
      const names = parseSelection(agentInput, agents.length)
        .map((i) => agents[i]?.name)
        .filter((n): n is string => n !== undefined);
      if (names.length === 0) continue;
      const existing = picks.get(tool) ?? [];
      picks.set(tool, [...existing, ...names]);
    }
    return { globalTools, picks };
  } finally {
    close();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runTools(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const dir = await resolveDir(opts.dir);
  const agents = await loadAgents(dir);
  const label = opts.check ? "[check] " : "";

  console.log(`agents dir: ${dir} (${agents.length} agents)`);

  // Phase 0 — caveman initialPrompt (always, idempotent).
  const cavemanChanged = await ensureInitialPrompt(agents, opts.check);
  console.log(
    cavemanChanged.length > 0
      ? `${label}initialPrompt (caveman ultra) added: ${cavemanChanged.join(", ")}`
      : "initialPrompt: all agents already set",
  );
  if (opts.cavemanOnly) return;

  // Tool selection.
  let globalTools = opts.all;
  let picks = opts.picks;
  if (opts.interactive) {
    const tools = await discoverTools([path.join(homedir(), ".claude", "agents"), dir]);
    const selected = await interactiveFlow(agents, tools);
    globalTools = selected.globalTools;
    picks = selected.picks;
  }
  if (globalTools.length === 0 && picks.size === 0) {
    console.log("no tool changes requested.");
    return;
  }

  // Validate pick agent names.
  const known = new Set(agents.map((a) => a.name));
  for (const [tool, names] of picks) {
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) throw new Error(`--pick ${tool}: unknown agent(s): ${unknown.join(", ")}`);
  }

  const applied = await applyTools(agents, globalTools, picks, opts.check);
  if (applied.size === 0) {
    console.log("no tool changes needed (already present).");
    return;
  }
  for (const [name, tools] of applied) {
    console.log(`${label}${name}: tools: ${tools.join(", ")}`);
  }
  console.log(`${label}${applied.size} agent file(s) ${opts.check ? "would change" : "updated"}.`);
}
