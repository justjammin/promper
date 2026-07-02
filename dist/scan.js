"use strict";
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
exports.runScan = runScan;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const path = __importStar(require("node:path"));
const classify_js_1 = require("./classify.js");
const frontmatter_js_1 = require("./frontmatter.js");
const MAP_VERSION = 1;
// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const opts = {
        extraDirs: [],
        check: false,
        legacy: false,
        outDir: path.join((0, node_os_1.homedir)(), ".invoker", "map"),
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--dir": {
                const value = argv[++i];
                if (!value)
                    throw new Error("--dir requires a path");
                opts.extraDirs.push(value);
                break;
            }
            case "--out": {
                const value = argv[++i];
                if (!value)
                    throw new Error("--out requires a path");
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
function defaultScanDirs() {
    const home = (0, node_os_1.homedir)();
    return [
        path.join(home, ".claude", "agents"),
        path.join(process.cwd(), ".claude", "agents"),
        path.join(home, ".codex", "agents"),
        path.join(home, ".gemini", "agents"),
    ];
}
/** Scan all dirs for *.md agent files. First occurrence of a name wins. */
async function scanDirs(dirs) {
    const agents = new Map();
    for (const dir of dirs) {
        let fileNames;
        try {
            fileNames = await node_fs_1.promises.readdir(dir);
        }
        catch {
            continue; // skip missing dirs silently
        }
        fileNames.sort();
        for (const fileName of fileNames) {
            if (!fileName.endsWith(".md"))
                continue;
            const fullPath = path.join(dir, fileName);
            let text;
            try {
                const stat = await node_fs_1.promises.stat(fullPath);
                if (!stat.isFile())
                    continue;
                text = await node_fs_1.promises.readFile(fullPath, "utf8");
            }
            catch {
                continue;
            }
            const fm = (0, frontmatter_js_1.parseFrontmatter)(text);
            if (fm === null)
                continue;
            let name = typeof fm["name"] === "string" ? fm["name"].trim() : "";
            if (!name)
                name = path.basename(fileName, ".md"); // fallback: filename stem
            if (agents.has(name))
                continue;
            const description = (0, frontmatter_js_1.flattenDescription)(fm["description"]);
            const modelRaw = fm["model"];
            const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
            const agent = {
                name,
                description,
                file: fileName,
                tools: (0, frontmatter_js_1.normalizeTools)(fm["tools"]),
                hasDescription: description.length > 0,
            };
            if (model !== undefined)
                agent.model = model;
            agents.set(name, agent);
        }
    }
    return agents;
}
// ---------------------------------------------------------------------------
// Existing map loading
// ---------------------------------------------------------------------------
async function loadExisting(outDir) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(path.join(outDir, "index.json"), "utf8");
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null)
        return null;
    const domainsRaw = parsed["domains"];
    if (typeof domainsRaw !== "object" || domainsRaw === null)
        return null;
    const assignments = new Map();
    const entries = new Map();
    const domains = [];
    for (const [domain, names] of Object.entries(domainsRaw)) {
        if (!Array.isArray(names))
            continue;
        domains.push(domain);
        for (const n of names) {
            if (typeof n === "string" && !assignments.has(n))
                assignments.set(n, domain);
        }
        // Load the piece file for entry details (description/file/model).
        let piece;
        try {
            piece = JSON.parse(await node_fs_1.promises.readFile(path.join(outDir, `${domain}.json`), "utf8"));
        }
        catch {
            continue; // missing/corrupt piece — entries rebuilt from scan
        }
        if (!Array.isArray(piece))
            continue;
        for (const e of piece) {
            if (typeof e !== "object" || e === null)
                continue;
            const entry = e;
            if (typeof entry.name !== "string" || entries.has(entry.name))
                continue;
            // Never store tools in pieces — strip if a legacy write left one behind.
            const { tools: _tools, ...rest } = entry;
            entries.set(entry.name, rest);
        }
    }
    return { assignments, entries, domains };
}
function makeEntry(scanned) {
    const entry = {
        name: scanned.name,
        description: scanned.description,
        file: scanned.file,
    };
    if (scanned.model !== undefined)
        entry.model = scanned.model;
    return entry;
}
function merge(scanned, existing) {
    const buckets = new Map();
    const newAgents = [];
    const dropped = [];
    const noDescription = [];
    let keptCount = 0;
    const push = (domain, entry) => {
        const bucket = buckets.get(domain);
        if (bucket)
            bucket.push(entry);
        else
            buckets.set(domain, [entry]);
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
        if (existing?.assignments.has(name))
            continue;
        if (!source.hasDescription) {
            noDescription.push(name); // skipped from map, reported as unmapped
            continue;
        }
        const { domain } = (0, classify_js_1.classify)(name, source.description);
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
function serializeIndex(buckets) {
    const domains = {};
    for (const domain of [...buckets.keys()].sort()) {
        const bucket = buckets.get(domain);
        if (bucket)
            domains[domain] = bucket.map((e) => e.name);
    }
    return JSON.stringify({ version: MAP_VERSION, domains }, null, 2) + "\n";
}
function serializePiece(entries) {
    return JSON.stringify(entries, null, 2) + "\n";
}
function serializeLegacy(buckets, scanned) {
    const domains = {};
    for (const domain of [...buckets.keys()].sort()) {
        const bucket = buckets.get(domain);
        if (!bucket)
            continue;
        domains[domain] = bucket.map((e) => {
            const source = scanned.get(e.name);
            const legacy = {
                name: e.name,
                file: e.file,
                description: e.description,
            };
            if (source && source.tools.length > 0)
                legacy["tools"] = source.tools;
            const model = e.model ?? source?.model;
            if (model !== undefined)
                legacy["model"] = model;
            return legacy;
        });
    }
    return JSON.stringify({ version: MAP_VERSION, domains }, null, 2) + "\n";
}
// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
async function readIfExists(filePath) {
    try {
        return await node_fs_1.promises.readFile(filePath, "utf8");
    }
    catch {
        return null;
    }
}
/** Write only when content differs. Returns true when the file changed. */
async function writeIfChanged(filePath, content, check) {
    const current = await readIfExists(filePath);
    if (current === content)
        return false;
    if (!check) {
        await node_fs_1.promises.mkdir(path.dirname(filePath), { recursive: true });
        await node_fs_1.promises.writeFile(filePath, content, "utf8");
    }
    return true;
}
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function runScan(argv) {
    const opts = parseArgs(argv);
    const dirs = [...defaultScanDirs(), ...opts.extraDirs];
    const scanned = await scanDirs(dirs);
    const existing = await loadExisting(opts.outDir);
    const result = merge(scanned, existing);
    const changedFiles = [];
    const staleRemoved = [];
    // index.json
    if (await writeIfChanged(path.join(opts.outDir, "index.json"), serializeIndex(result.buckets), opts.check)) {
        changedFiles.push("index.json");
    }
    // pieces
    for (const domain of [...result.buckets.keys()].sort()) {
        const bucket = result.buckets.get(domain);
        if (!bucket)
            continue;
        const pieceFile = `${domain}.json`;
        if (await writeIfChanged(path.join(opts.outDir, pieceFile), serializePiece(bucket), opts.check)) {
            changedFiles.push(pieceFile);
        }
    }
    // stale pieces (domain emptied out entirely)
    for (const domain of result.previousDomains) {
        if (result.buckets.has(domain))
            continue;
        const piecePath = path.join(opts.outDir, `${domain}.json`);
        if ((await readIfExists(piecePath)) === null)
            continue;
        if (!opts.check)
            await node_fs_1.promises.unlink(piecePath);
        staleRemoved.push(`${domain}.json`);
    }
    // legacy map
    if (opts.legacy) {
        const legacyPath = path.join((0, node_os_1.homedir)(), ".invoker", "agent-map.json");
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
    const lines = [];
    lines.push(`map:      ${opts.outDir}`);
    lines.push(`domains:  ${result.buckets.size}`);
    lines.push(`agents:   ${agentCount} (${result.keptCount} existing kept, ${result.newAgents.length} new)`);
    lines.push(`new (${result.newAgents.length}):`);
    for (const a of result.newAgents)
        lines.push(`  ${a.name} -> ${a.domain}`);
    lines.push(`dropped (${result.dropped.length}):`);
    for (const name of result.dropped)
        lines.push(`  ${name}`);
    lines.push(`unmapped (${unmapped.length}):`);
    for (const name of unmapped)
        lines.push(`  ${name}`);
    if (staleRemoved.length > 0) {
        lines.push(`stale pieces removed (${staleRemoved.length}): ${staleRemoved.join(", ")}`);
    }
    if (opts.check) {
        lines.push(changedFiles.length > 0
            ? `[check] dry run — would write: ${changedFiles.join(", ")}`
            : "[check] dry run — no changes");
    }
    else {
        lines.push(changedFiles.length > 0 ? `wrote: ${changedFiles.join(", ")}` : "no changes (map up to date)");
    }
    console.log(lines.join("\n"));
}
