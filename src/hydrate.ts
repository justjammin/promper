/**
 * hydrate.ts — `promper hydrate <agent> "<task>"`: build a spawn-ready prompt
 * from a plugin agent's persona plus its plugin toolkit, without installing
 * the plugin (installed plugins cost ambient context in every session;
 * hydration costs tokens only at spawn time).
 *
 * Resolution order:
 *   1. The lean map (~/.invoker/map): O(1) name or file-stem lookup across
 *      pieces; `roots` in index.json resolves relative paths.
 *   2. Fallback: recursive walk of <root>/plugins/<plugin>/agents/ by stem.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { parseFrontmatter } from "./frontmatter.js";

const DEFAULT_TEMPLATE = `You are operating under an adopted specialist role from a plugin marketplace.
Assume the operational identity, expertise, and constraints below completely.
Do not announce the adoption or speak out of character.

[ADOPTED ROLE — {{AGENT_NAME}}{{PLUGIN_SUFFIX}}]
{{TARGET_ROLE_PROFILE}}
{{TOOLKIT_BLOCK}}
[TASK]
{{USER_TASK}}
`;

interface HydrateOptions {
  agent: string;
  task: string;
  mapDir: string;
  templatePath: string | null;
  json: boolean;
}

interface ResolvedAgent {
  name: string;
  absPath: string;
  plugin: string | null;
  root: string | null;
}

function parseArgs(argv: string[]): HydrateOptions {
  const positional: string[] = [];
  const opts: HydrateOptions = {
    agent: "",
    task: "",
    mapDir: path.join(homedir(), ".invoker", "map"),
    templatePath: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--map": {
        const value = argv[++i];
        if (!value) throw new Error("--map requires a path");
        opts.mapDir = value;
        break;
      }
      case "--template": {
        const value = argv[++i];
        if (!value) throw new Error("--template requires a path");
        opts.templatePath = value;
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
  const agent = positional.shift();
  if (!agent) throw new Error('usage: promper hydrate <agent> "<task>" [--template <path>] [--map <dir>] [--json]');
  opts.agent = agent;
  opts.task = positional.join(" ").trim();
  if (!opts.task) throw new Error("hydrate requires a task description after the agent name");
  return opts;
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Map lookup: exact entry name, else file-stem match (fastapi-pro -> python-development-fastapi-pro). */
async function resolveViaMap(mapDir: string, agent: string): Promise<ResolvedAgent | null> {
  const index = (await readJson(path.join(mapDir, "index.json"))) as
    | { roots?: string[]; domains?: Record<string, string[]> }
    | null;
  if (!index || typeof index.domains !== "object" || index.domains === null) return null;
  const roots = Array.isArray(index.roots) ? index.roots : [];
  const wanted = agent.toLowerCase();

  for (const domain of Object.keys(index.domains)) {
    const piece = (await readJson(path.join(mapDir, `${domain}.json`))) as
      | Array<{ name?: string; file?: string; plugin?: string }>
      | null;
    if (!Array.isArray(piece)) continue;
    for (const entry of piece) {
      if (typeof entry?.name !== "string" || typeof entry.file !== "string") continue;
      const stem = path.basename(entry.file, ".md").toLowerCase();
      if (entry.name.toLowerCase() !== wanted && stem !== wanted) continue;

      const plugin = typeof entry.plugin === "string" ? entry.plugin : null;
      if (path.isAbsolute(entry.file)) {
        return { name: entry.name, absPath: entry.file, plugin, root: null };
      }
      // Relative: resolve against marketplace roots, then ~/.claude/agents (basenames).
      for (const root of roots) {
        const candidate = path.join(root, entry.file);
        try {
          await fs.access(candidate);
          return { name: entry.name, absPath: candidate, plugin, root };
        } catch {
          /* try next root */
        }
      }
      const local = path.join(homedir(), ".claude", "agents", entry.file);
      try {
        await fs.access(local);
        return { name: entry.name, absPath: local, plugin, root: null };
      } catch {
        /* fall through to next entry */
      }
    }
  }
  return null;
}

/** Fallback: walk each root's plugins/<plugin>/agents/ dirs for a stem match. */
async function resolveViaWalk(roots: string[], agent: string): Promise<ResolvedAgent | null> {
  const wanted = agent.toLowerCase();
  for (const root of roots) {
    const pluginsDir = path.join(root, "plugins");
    let plugins: string[];
    try {
      plugins = (await fs.readdir(pluginsDir)).sort();
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      const agentsDir = path.join(pluginsDir, plugin, "agents");
      let files: string[];
      try {
        files = (await fs.readdir(agentsDir)).sort();
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (path.basename(file, ".md").toLowerCase() !== wanted) continue;
        return { name: path.basename(file, ".md"), absPath: path.join(agentsDir, file), plugin, root };
      }
    }
  }
  return null;
}

/** Persona = the body below the frontmatter (frontmatter is routing metadata, not voice). */
function personaBody(text: string): string {
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) return text.slice(end + 4).replace(/^\n+/, "").trimEnd();
  }
  return text.trim();
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => !n.startsWith(".")).map((n) => n.replace(/\.md$/, "")).sort();
  } catch {
    return [];
  }
}

export async function runHydrate(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);

  const index = (await readJson(path.join(opts.mapDir, "index.json"))) as { roots?: string[] } | null;
  const roots = Array.isArray(index?.roots) ? (index?.roots as string[]) : [];
  const cwdPlugins = path.join(process.cwd(), "plugins");
  try {
    await fs.access(cwdPlugins);
    if (!roots.includes(process.cwd())) roots.push(process.cwd());
  } catch {
    /* cwd is not a marketplace */
  }

  const resolved = (await resolveViaMap(opts.mapDir, opts.agent)) ?? (await resolveViaWalk(roots, opts.agent));
  if (!resolved) {
    throw new Error(
      `agent "${opts.agent}" not found in the map (${opts.mapDir}) or under any marketplace root — run \`promper scan --plugins <root>\` first`,
    );
  }

  const raw = await fs.readFile(resolved.absPath, "utf8");
  const fm = parseFrontmatter(raw);
  const displayName = (typeof fm?.["name"] === "string" && (fm["name"] as string).trim()) || resolved.name;
  const persona = personaBody(raw);

  let toolkitBlock = "";
  let skills: string[] = [];
  let commands: string[] = [];
  if (resolved.plugin && resolved.root) {
    const pluginDir = path.join(resolved.root, "plugins", resolved.plugin);
    skills = await listNames(path.join(pluginDir, "skills"));
    commands = await listNames(path.join(pluginDir, "commands"));
    if (skills.length > 0 || commands.length > 0) {
      const parts: string[] = [];
      if (skills.length > 0) parts.push(`skills: ${skills.join(", ")}`);
      if (commands.length > 0) parts.push(`commands: ${commands.join(", ")}`);
      toolkitBlock = `\n[TOOLKIT]\nThis role carries the ${resolved.plugin} toolkit — ${parts.join("; ")}.\nReach for these when relevant.\n`;
    }
  }

  const template = opts.templatePath ? await fs.readFile(opts.templatePath, "utf8") : DEFAULT_TEMPLATE;
  const prompt = template
    .replaceAll("{{AGENT_NAME}}", displayName)
    .replaceAll("{{PLUGIN_SUFFIX}}", resolved.plugin ? ` (${resolved.plugin})` : "")
    .replaceAll("{{PLUGIN}}", resolved.plugin ?? "")
    .replaceAll("{{TARGET_ROLE_PROFILE}}", persona)
    .replaceAll("{{TOOLKIT_BLOCK}}", toolkitBlock)
    .replaceAll("{{USER_TASK}}", opts.task);

  if (opts.json) {
    console.log(
      JSON.stringify(
        { agent: displayName, plugin: resolved.plugin, source: resolved.absPath, skills, commands, prompt },
        null,
        2,
      ),
    );
    return;
  }
  console.log(prompt);
}
