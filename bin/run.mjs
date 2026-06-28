#!/usr/bin/env node
// `promper-run` — a stdio-rewriting runner that wraps the model call.
//
// This is the "edit the stdio" approach (vs. the UserPromptSubmit hook, which can only
// inject context). The runner owns the whole pipeline:
//
//   raw intent (stdin / argv)
//     → route via invokerai (~/.invoker/agent-map.json) to the proper agent
//        → inherit that agent's persona as <role>
//     → engineer the prompt body around that role   (pass 1: Prompt Engineer model call)
//     → REWRITE the prompt that goes downstream
//     → run the engineered prompt against the model  (pass 2: the --run pass)
//   → result (stdout)
//
// The `--run` step is injected by the runner. `--prompt-only` stops after the rewrite
// (pure stdio editing, no run). `--dry-run` does routing + skeleton with no API calls.
//
// Usage:
//   promper-run "write a tweet announcing my budgeting app"
//   echo "write a tweet ..." | promper-run
//   promper-run --prompt-only "..."        # emit the rewritten prompt, don't run it
//   promper-run --dry-run "..."            # show routing + skeleton, no API call
//   promper-run --agent=content-marketer "..."   # force the role source
//   promper-run --target=costar "..."      # CO-STAR skeleton instead of Claude-XML
//   promper-run --model=claude-opus-4-8 --effort=high "..."
//
// Requires ANTHROPIC_API_KEY in the environment (the SDK reads it) for engineering/running.

import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_EFFORT = "high";

// ---- arg parsing ------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    run: true, // default: engineer AND run (the --run pass is injected)
    promptOnly: false,
    dryRun: false,
    agent: null,
    target: "portable", // portable | costar
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    intentParts: [],
  };
  for (const a of argv) {
    if (a === "--prompt-only") opts.promptOnly = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--run") opts.run = true;
    else if (a === "--no-run") opts.run = false;
    else if (a.startsWith("--agent=")) opts.agent = a.slice(8);
    else if (a.startsWith("--target=")) opts.target = a.slice(9);
    else if (a.startsWith("--model=")) opts.model = a.slice(8);
    else if (a.startsWith("--effort=")) opts.effort = a.slice(9);
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts.intentParts.push(a);
  }
  return opts;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(""));
  });
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ---- role inheritance (invokerai routing) -----------------------------------

// Flatten the agent map into [{name, description}] across a few plausible shapes.
function flattenAgents(map) {
  const out = [];
  const push = (name, description) => {
    if (name) out.push({ name: String(name), description: String(description || "") });
  };
  if (!map || typeof map !== "object") return out;

  if (Array.isArray(map.agents)) {
    for (const a of map.agents) push(a.name || a.id, a.description || a.persona);
  }
  if (map.domains && typeof map.domains === "object") {
    for (const d of Object.values(map.domains)) {
      const agents = Array.isArray(d?.agents) ? d.agents : [];
      for (const a of agents) push(a.name || a.id, a.description || a.persona);
    }
  }
  // name -> description (or name -> {description})
  if (out.length === 0) {
    for (const [k, v] of Object.entries(map)) {
      if (k === "agents" || k === "domains") continue;
      if (typeof v === "string") push(k, v);
      else if (v && typeof v === "object") push(k, v.description || v.persona);
    }
  }
  return out;
}

const STOP = new Set(
  "a an the to for of and or in on with my your this that make write create build help me into prompt".split(/\s+/)
);

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
}

// Deterministic best-match: score each agent's description against the intent tokens.
// Mirrors invokerai's "match the action to each candidate agent's description".
function selectAgent(intent, agents, override) {
  if (override) {
    const found = agents.find((a) => a.name === override);
    return {
      agent: override,
      role: found?.description || `a domain expert in ${override.replace(/-/g, " ")}`,
      gap: found ? null : `forced agent "${override}" not found in agent map`,
    };
  }
  if (!agents.length) {
    return { agent: null, role: null, gap: "no agent map — falling back to a generic expert role" };
  }
  const want = new Set(tokenize(intent));
  let best = null;
  let bestScore = 0;
  for (const a of agents) {
    const desc = new Set(tokenize(a.name + " " + a.description));
    let score = 0;
    for (const w of want) if (desc.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (!best || bestScore === 0) {
    return {
      agent: agents[0]?.name || null,
      role: agents[0]?.description || null,
      gap: "no strong agent match — using the closest available role",
    };
  }
  return { agent: best.name, role: best.description, gap: null };
}

// ---- skeletons --------------------------------------------------------------

function genericRole(intent) {
  return `an expert practitioner suited to: ${intent.slice(0, 120)}`;
}

function xmlSkeleton(role, intent) {
  return `<role>
${role}
</role>

<context>
{Background, inputs, and the WHY behind: ${intent}}
</context>

<instructions>
1. {Explicit, ordered, positive steps for the task.}
2. {Say what to do; handle the obvious edge cases.}
</instructions>

<constraints>
- {Bounds, must/must-not, length.}
- If unsure or information is missing, say so rather than inventing.
</constraints>

<output_format>
{Describe the exact shape, then show a short sample.}
</output_format>

${intent}`;
}

function costarSkeleton(role, intent) {
  return `# CONTEXT
{Background and the WHY behind: ${intent}}

# OBJECTIVE
${intent}

# STYLE
{Writing/format style, grounded in the role: ${role}}

# TONE
{Desired tone.}

# AUDIENCE
{Who this is for.}

# RESPONSE FORMAT
{Exact shape + a short sample.}`;
}

// ---- model plumbing ---------------------------------------------------------

async function loadSdk() {
  try {
    const mod = await import("@anthropic-ai/sdk");
    return mod.default;
  } catch {
    throw new Error(
      "@anthropic-ai/sdk is not installed. Run `npm install` in the promper repo " +
        "(it is a dependency), or `npm i @anthropic-ai/sdk`."
    );
  }
}

function ensureKey() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is not set — the runner needs it to engineer and run prompts.");
  }
}

// Pass 1 — rewrite the raw intent into an engineered prompt around the inherited role.
async function engineer(client, { intent, role, target, principles, model }) {
  const skeletonName = target === "costar" ? "CO-STAR" : "Claude-native XML";
  const system =
    "You are an elite Prompt Engineer. You turn a rough intent into a single, well-engineered, " +
    "role-grounded prompt. The <role> is GIVEN to you (inherited from a selected agent) — use it " +
    "verbatim as the persona; never invent a different role. Apply the prompt-engineering principles " +
    "below. Emit ONLY the finished prompt (the " +
    skeletonName +
    " artifact) — no preamble, no explanation, no code fences.\n\n" +
    "=== PROMPT-ENGINEERING PRINCIPLES (source of truth) ===\n" +
    principles;

  const user =
    `Inherited <role> (use verbatim as the persona):\n${role}\n\n` +
    `Target skeleton: ${skeletonName}\n\n` +
    `Raw intent to engineer into a prompt:\n${intent}\n\n` +
    `Produce the finished prompt now. Fill every applicable section; omit sections that don't apply ` +
    `(never emit empty tags). Mark any slot the user must fill with [DRAFT — replace].`;

  const resp = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = (resp.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text;
}

// Pass 2 — run the engineered prompt. Role is the system prompt (the agent "is" the role);
// the engineered prompt is the task brief. Streamed so long outputs don't hit timeouts.
async function run(client, { engineeredPrompt, role, model, effort }) {
  const stream = client.messages.stream({
    model,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort },
    system: `You are ${role}`,
    messages: [{ role: "user", content: engineeredPrompt }],
  });

  stream.on("text", (delta) => process.stdout.write(delta));
  await stream.finalMessage();
  process.stdout.write("\n");
}

// ---- main -------------------------------------------------------------------

const HELP = `promper-run — stdio-rewriting runner (engineer a prompt, then run it)

  promper-run [flags] "<rough intent>"
  echo "<rough intent>" | promper-run [flags]

Flags:
  --prompt-only      Emit the engineered prompt and stop (don't run it).
  --no-run           Alias for --prompt-only.
  --dry-run          Show routing + skeleton scaffold; no API calls.
  --agent=<name>     Force the role source (override invokerai routing).
  --target=costar    Emit CO-STAR instead of Claude-native XML.
  --model=<id>       Model (default ${DEFAULT_MODEL}).
  --effort=<level>   low|medium|high|xhigh|max for the run pass (default ${DEFAULT_EFFORT}).
  -h, --help         This help.

Routing reads ~/.invoker/agent-map.json (invokerai). Needs ANTHROPIC_API_KEY to call the model.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.promptOnly) opts.run = false;

  const argIntent = opts.intentParts.join(" ").trim();
  const intent = argIntent || (await readStdin()).trim();
  if (!intent) {
    console.error("promper-run: no intent given (pass it as an argument or on stdin).\n");
    console.error(HELP);
    process.exit(1);
  }

  // Route via invokerai → inherit the role.
  const mapPath = join(homedir(), ".invoker", "agent-map.json");
  let agents = [];
  if (await exists(mapPath)) {
    try {
      agents = flattenAgents(JSON.parse(await readFile(mapPath, "utf8")));
    } catch (err) {
      console.error(`promper-run: could not parse ${mapPath}: ${err.message}`);
    }
  }
  const picked = selectAgent(intent, agents, opts.agent);
  const role = picked.role || genericRole(intent);

  // Routing header → stderr, so stdout stays a clean prompt/result pipe.
  const header = picked.agent
    ? `invokerai picked ${picked.agent} → role = ${role.slice(0, 80)}${role.length > 80 ? "…" : ""}`
    : `no agent selected → generic role`;
  console.error(`[promper-run] ${header}`);
  if (picked.gap) console.error(`[promper-run] note: ${picked.gap}`);

  // Dry run: deterministic scaffold only, no API.
  if (opts.dryRun) {
    const skel = opts.target === "costar" ? costarSkeleton(role, intent) : xmlSkeleton(role, intent);
    console.error(`[promper-run] dry-run (no API call). Skeleton:\n`);
    process.stdout.write(skel + "\n");
    return;
  }

  ensureKey();
  const Anthropic = await loadSdk();
  const client = new Anthropic();

  // Pass 1: rewrite the raw intent into the engineered prompt.
  const principles = await readFile(join(root, "reference", "pe-principles.md"), "utf8");
  const engineeredPrompt = await engineer(client, {
    intent,
    role,
    target: opts.target,
    principles,
    model: opts.model,
  });

  if (!opts.run) {
    // Pure stdio rewrite: emit the engineered prompt downstream.
    process.stdout.write(engineeredPrompt + "\n");
    return;
  }

  // Pass 2: the injected --run pass — execute the engineered prompt.
  console.error(`[promper-run] running engineered prompt (effort=${opts.effort})…\n`);
  await run(client, { engineeredPrompt, role, model: opts.model, effort: opts.effort });
}

main().catch((err) => {
  console.error(`\npromper-run failed: ${err.message}\n`);
  process.exit(1);
});
