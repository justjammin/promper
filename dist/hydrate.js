"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHydrate = runHydrate;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const path = __importStar(require("node:path"));
const frontmatter_js_1 = require("./frontmatter.js");
const DEFAULT_TEMPLATE = `You are operating under an adopted specialist role from a plugin marketplace.
Assume the operational identity, expertise, and constraints below completely.
Do not announce the adoption or speak out of character.

[ADOPTED ROLE — {{AGENT_NAME}}{{PLUGIN_SUFFIX}}]
{{TARGET_ROLE_PROFILE}}
{{TOOLKIT_BLOCK}}
[TASK]
{{USER_TASK}}
`;
function parseArgs(argv) {
    const positional = [];
    const opts = {
        agent: "",
        task: "",
        mapDir: path.join((0, node_os_1.homedir)(), ".invoker", "map"),
        templatePath: null,
        json: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === undefined)
            continue;
        switch (arg) {
            case "--map": {
                const value = argv[++i];
                if (!value)
                    throw new Error("--map requires a path");
                opts.mapDir = value;
                break;
            }
            case "--template": {
                const value = argv[++i];
                if (!value)
                    throw new Error("--template requires a path");
                opts.templatePath = value;
                break;
            }
            case "--json":
                opts.json = true;
                break;
            default:
                if (arg.startsWith("--"))
                    throw new Error(`unknown flag: ${arg}`);
                positional.push(arg);
        }
    }
    const agent = positional.shift();
    if (!agent)
        throw new Error('usage: promper hydrate <agent> "<task>" [--template <path>] [--map <dir>] [--json]');
    opts.agent = agent;
    opts.task = positional.join(" ").trim();
    if (!opts.task)
        throw new Error("hydrate requires a task description after the agent name");
    return opts;
}
async function readJson(filePath) {
    try {
        return JSON.parse(await node_fs_1.promises.readFile(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
/** Map lookup: exact entry name, else file-stem match (fastapi-pro -> python-development-fastapi-pro). */
async function resolveViaMap(mapDir, agent) {
    const index = (await readJson(path.join(mapDir, "index.json")));
    if (!index || typeof index.domains !== "object" || index.domains === null)
        return null;
    const roots = Array.isArray(index.roots) ? index.roots : [];
    const wanted = agent.toLowerCase();
    for (const domain of Object.keys(index.domains)) {
        const piece = (await readJson(path.join(mapDir, `${domain}.json`)));
        if (!Array.isArray(piece))
            continue;
        for (const entry of piece) {
            if (typeof entry?.name !== "string" || typeof entry.file !== "string")
                continue;
            const stem = path.basename(entry.file, ".md").toLowerCase();
            if (entry.name.toLowerCase() !== wanted && stem !== wanted)
                continue;
            const plugin = typeof entry.plugin === "string" ? entry.plugin : null;
            if (path.isAbsolute(entry.file)) {
                return { name: entry.name, absPath: entry.file, plugin, root: null };
            }
            // Relative: resolve against marketplace roots, then ~/.claude/agents (basenames).
            for (const root of roots) {
                const candidate = path.join(root, entry.file);
                try {
                    await node_fs_1.promises.access(candidate);
                    return { name: entry.name, absPath: candidate, plugin, root };
                }
                catch {
                    /* try next root */
                }
            }
            const local = path.join((0, node_os_1.homedir)(), ".claude", "agents", entry.file);
            try {
                await node_fs_1.promises.access(local);
                return { name: entry.name, absPath: local, plugin, root: null };
            }
            catch {
                /* fall through to next entry */
            }
        }
    }
    return null;
}
/** Fallback: walk each root's plugins/<plugin>/agents/ dirs for a stem match. */
async function resolveViaWalk(roots, agent) {
    const wanted = agent.toLowerCase();
    for (const root of roots) {
        const pluginsDir = path.join(root, "plugins");
        let plugins;
        try {
            plugins = (await node_fs_1.promises.readdir(pluginsDir)).sort();
        }
        catch {
            continue;
        }
        for (const plugin of plugins) {
            const agentsDir = path.join(pluginsDir, plugin, "agents");
            let files;
            try {
                files = (await node_fs_1.promises.readdir(agentsDir)).sort();
            }
            catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith(".md"))
                    continue;
                if (path.basename(file, ".md").toLowerCase() !== wanted)
                    continue;
                return { name: path.basename(file, ".md"), absPath: path.join(agentsDir, file), plugin, root };
            }
        }
    }
    return null;
}
/** Persona = the body below the frontmatter (frontmatter is routing metadata, not voice). */
function personaBody(text) {
    if (text.startsWith("---")) {
        const end = text.indexOf("\n---", 3);
        if (end !== -1)
            return text.slice(end + 4).replace(/^\n+/, "").trimEnd();
    }
    return text.trim();
}
async function listNames(dir) {
    try {
        return (await node_fs_1.promises.readdir(dir)).filter((n) => !n.startsWith(".")).map((n) => n.replace(/\.md$/, "")).sort();
    }
    catch {
        return [];
    }
}
async function runHydrate(argv) {
    const opts = parseArgs(argv);
    const index = (await readJson(path.join(opts.mapDir, "index.json")));
    const roots = Array.isArray(index?.roots) ? index?.roots : [];
    const cwdPlugins = path.join(process.cwd(), "plugins");
    try {
        await node_fs_1.promises.access(cwdPlugins);
        if (!roots.includes(process.cwd()))
            roots.push(process.cwd());
    }
    catch {
        /* cwd is not a marketplace */
    }
    const resolved = (await resolveViaMap(opts.mapDir, opts.agent)) ?? (await resolveViaWalk(roots, opts.agent));
    if (!resolved) {
        throw new Error(`agent "${opts.agent}" not found in the map (${opts.mapDir}) or under any marketplace root — run \`promper scan --plugins <root>\` first`);
    }
    const raw = await node_fs_1.promises.readFile(resolved.absPath, "utf8");
    const fm = (0, frontmatter_js_1.parseFrontmatter)(raw);
    const displayName = (typeof fm?.["name"] === "string" && fm["name"].trim()) || resolved.name;
    const persona = personaBody(raw);
    let toolkitBlock = "";
    let skills = [];
    let commands = [];
    if (resolved.plugin && resolved.root) {
        const pluginDir = path.join(resolved.root, "plugins", resolved.plugin);
        skills = await listNames(path.join(pluginDir, "skills"));
        commands = await listNames(path.join(pluginDir, "commands"));
        if (skills.length > 0 || commands.length > 0) {
            const parts = [];
            if (skills.length > 0)
                parts.push(`skills: ${skills.join(", ")}`);
            if (commands.length > 0)
                parts.push(`commands: ${commands.join(", ")}`);
            toolkitBlock = `\n[TOOLKIT]\nThis role carries the ${resolved.plugin} toolkit — ${parts.join("; ")}.\nReach for these when relevant.\n`;
        }
    }
    const template = opts.templatePath ? await node_fs_1.promises.readFile(opts.templatePath, "utf8") : DEFAULT_TEMPLATE;
    const prompt = template
        .replaceAll("{{AGENT_NAME}}", displayName)
        .replaceAll("{{PLUGIN_SUFFIX}}", resolved.plugin ? ` (${resolved.plugin})` : "")
        .replaceAll("{{PLUGIN}}", resolved.plugin ?? "")
        .replaceAll("{{TARGET_ROLE_PROFILE}}", persona)
        .replaceAll("{{TOOLKIT_BLOCK}}", toolkitBlock)
        .replaceAll("{{USER_TASK}}", opts.task);
    if (opts.json) {
        console.log(JSON.stringify({ agent: displayName, plugin: resolved.plugin, source: resolved.absPath, skills, commands, prompt }, null, 2));
        return;
    }
    console.log(prompt);
}
