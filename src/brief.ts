/**
 * brief.ts — `promper brief "<task>" [--agent <name>] [--subagent-type <type>] [--json]`
 *
 * Deterministic, role-bearing spawn brief. No LLM, no routing — the role is inherited only
 * when a name is already resolvable; it is never invented. This is the engine behind the
 * `PreToolUse` spawn hook (hooks/enrich-spawn.mjs), which shells out to this on every
 * Agent/Task spawn.
 *
 * Precedence:
 *   1. --subagent-type names a real agent (anything but "general-purpose") — the harness
 *      already loads its system prompt natively. Emit structure + toolkit only; no persona
 *      re-injection (that would double the role).
 *   2. --subagent-type is "general-purpose" (or omitted) AND a name resolves — via --agent,
 *      else a fresh same-repo entry in ~/.invoker/state/promper-decision.json — delegate to
 *      hydrateAgent() for the full persona + toolkit + task.
 *   3. general-purpose + no name resolvable — skeleton with an explicit
 *      "[ROLE — unrouted]" slot. Routing needs the LLM layer; this layer never guesses one.
 */

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { effectiveRoots, hydrateAgent, loadPluginToolkit, resolveViaMap, resolveViaWalk } from "./hydrate.js";

const HALLUCINATION_GUARD = "If unsure or information is missing, say so rather than inventing.";
const STATE_TTL_MS = 60 * 60 * 1000; // matches the Step 7.5 edit-gate's 60-min TTL

interface BriefOptions {
  task: string;
  agent: string | null;
  subagentType: string | null;
  mapDir: string;
  statePath: string;
  json: boolean;
}

interface RoutingDecision {
  verdict?: string;
  repo?: string;
  agent?: string;
  reason?: string;
  ts?: number;
}

export interface BriefResult {
  row: "named-agent" | "hydrated" | "unrouted";
  agent: string | null;
  plugin: string | null;
  source: string | null;
  prompt: string;
  /**
   * True when this brief adds nothing beyond the original task (no role, no toolkit) — the
   * skeleton/boilerplate would only dilute a prompt the caller already wrote. Callers that
   * rewrite a live spawn (the PreToolUse hook) MUST leave the original prompt untouched when
   * this is true; only CLI/manual callers should still consult `prompt` as a scaffold.
   */
  noop: boolean;
  /** Advisory note for the operator/main agent — never embedded in `prompt` (wrong audience
   *  for a spawned subagent). */
  note: string | null;
}

function parseArgs(argv: string[]): BriefOptions {
  const positional: string[] = [];
  const opts: BriefOptions = {
    task: "",
    agent: null,
    subagentType: null,
    mapDir: path.join(homedir(), ".invoker", "map"),
    statePath: path.join(homedir(), ".invoker", "state", "promper-decision.json"),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--agent": {
        const value = argv[++i];
        if (!value) throw new Error("--agent requires a name");
        opts.agent = value;
        break;
      }
      case "--subagent-type": {
        const value = argv[++i];
        if (!value) throw new Error("--subagent-type requires a value");
        opts.subagentType = value;
        break;
      }
      case "--map": {
        const value = argv[++i];
        if (!value) throw new Error("--map requires a path");
        opts.mapDir = value;
        break;
      }
      case "--state": {
        const value = argv[++i];
        if (!value) throw new Error("--state requires a path");
        opts.statePath = value;
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
  opts.task = positional.join(" ").trim();
  if (!opts.task) throw new Error('usage: promper brief "<task>" [--agent <name>] [--subagent-type <type>] [--json]');
  return opts;
}

/**
 * `git rev-parse --show-toplevel` for the cwd, matching what SKILL.md Step 7.5 instructs the
 * model to record as `repo` — falls back to cwd itself outside a git repo (same fallback
 * SKILL.md documents), so both sides of the comparison degrade identically.
 */
function gitRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  const top = result.status === 0 ? result.stdout.trim() : "";
  return top || process.cwd();
}

/** A fresh, same-repo agent name from the persisted routing decision — or null if absent/stale. */
async function persistedAgent(statePath: string): Promise<string | null> {
  let decision: RoutingDecision;
  try {
    decision = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    return null;
  }
  if (typeof decision.agent !== "string" || !decision.agent.trim()) return null;
  if (typeof decision.repo !== "string" || path.resolve(decision.repo) !== path.resolve(gitRoot())) return null;
  if (typeof decision.ts !== "number" || Date.now() - decision.ts > STATE_TTL_MS) return null;
  return decision.agent;
}

const UNROUTED_NOTE =
  "no specialist agent resolved for this task — run /promper to route it, or pass --agent explicitly. " +
  "This brief was left untouched: with no role or toolkit to add, a generic skeleton would only dilute it.";

/**
 * Scaffold for CLI/manual use only — shows the pe-principles skeleton a human can fill in.
 * Never used to rewrite a live spawn (see `noop` on BriefResult): the `<role>` tag is purely
 * descriptive, never an instruction, since a spawned subagent (the audience for `prompt`) can't
 * run a slash command — that guidance lives in `note` instead, for the operator.
 */
function unroutedSkeleton(task: string): string {
  return `<role>
[ROLE — unrouted: no specialist agent could be resolved for this task]
</role>

<context>
No routing decision is available yet — this brief was generated deterministically, without a resolved specialist agent.
</context>

<instructions>
1. Complete the task below.
2. If any requirement is ambiguous or underspecified, say so rather than guessing.
</instructions>

<constraints>
- ${HALLUCINATION_GUARD}
</constraints>

<output_format>
Match whatever format the task implies; default to clear prose if none is implied.
</output_format>

[TASK]
${task}
`;
}

function namedAgentBrief(task: string, toolkitBlock: string): string {
  return `<context>
Role is already established by the spawned agent — do not restate or re-introduce a persona.
</context>

<instructions>
1. Complete the task below using your existing expertise and toolkit.
2. If any requirement is ambiguous or underspecified, say so rather than guessing.
</instructions>
${toolkitBlock}
<constraints>
- ${HALLUCINATION_GUARD}
</constraints>

[TASK]
${task}
`;
}

export async function buildBrief(opts: BriefOptions): Promise<BriefResult> {
  // Row 1: a real, named agent — the harness already loaded its system prompt.
  if (opts.subagentType && opts.subagentType !== "general-purpose") {
    // Real subagent_type values are "domain:agent-name" (e.g.
    // "backend-development:backend-development-backend-architect"); the map stores the
    // bare agent-name half, so strip the domain prefix before looking it up.
    const lookupName = opts.subagentType.includes(":")
      ? opts.subagentType.slice(opts.subagentType.indexOf(":") + 1)
      : opts.subagentType;
    const resolved =
      (await resolveViaMap(opts.mapDir, lookupName)) ??
      (await resolveViaWalk(await effectiveRoots(opts.mapDir), lookupName));
    const toolkitBlock = resolved ? (await loadPluginToolkit(resolved)).block : "";
    // Toolkit surfacing is row 1's only genuine value-add (the harness already supplies the
    // persona) — with none found, the boilerplate below would just dilute the original brief.
    const noop = toolkitBlock === "";
    return {
      row: "named-agent",
      agent: opts.subagentType,
      plugin: resolved?.plugin ?? null,
      source: resolved?.absPath ?? null,
      prompt: namedAgentBrief(opts.task, toolkitBlock),
      noop,
      note: noop ? `no toolkit found for "${opts.subagentType}" — brief left untouched.` : null,
    };
  }

  // Row 2: general-purpose, but a name is already known.
  const name = opts.agent ?? (await persistedAgent(opts.statePath));
  if (name) {
    const result = await hydrateAgent(name, opts.task, { mapDir: opts.mapDir });
    return {
      row: "hydrated",
      agent: result.agent,
      plugin: result.plugin,
      source: result.source,
      prompt: result.prompt,
      noop: false,
      note: null,
    };
  }

  // Row 3: nothing resolvable — never invent a role, and never dilute the original brief.
  return {
    row: "unrouted",
    agent: null,
    plugin: null,
    source: null,
    prompt: unroutedSkeleton(opts.task),
    noop: true,
    note: UNROUTED_NOTE,
  };
}

export async function runBrief(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const result = await buildBrief(opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.note) console.error(`note: ${result.note}`); // stderr — never contaminates stdout piping
  console.log(result.prompt);
}
