#!/usr/bin/env node
// PreToolUse hook (matcher "Agent|Task") — promper's "on any subagent spawn" trigger.
// Deterministic: rewrites tool_input.prompt to a role-bearing brief before the subagent
// spawns. Never calls an LLM. See `promper brief` (src/brief.ts) for the precedence table.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no mutation).

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const READ_ONLY_SPAWNS = new Set(["Explore", "Plan"]);
const ENGINEERED_MARKER = "<instructions>";

// Debug trace: set PROMPER_DEBUG_LOG=<path> to append one JSON line per decision.
// No-op (and zero cost) when unset — this hook otherwise has no observable side channel.
function debug(event, data) {
  const logPath = process.env.PROMPER_DEBUG_LOG;
  if (!logPath) return;
  try {
    appendFileSync(logPath, JSON.stringify({ event, ...data }) + "\n");
  } catch {
    /* debug logging must never break the hook */
  }
}

function passThrough(reason) {
  debug("pass-through", { reason });
  process.exit(0);
}

async function main() {
  if (process.env.PROMPER_ACTIVE === "0") return passThrough("PROMPER_ACTIVE=0");

  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return passThrough("parse-error"); // malformed input — never block the real tool call
  }

  if (input.hook_event_name !== "PreToolUse" || !/^(Agent|Task)$/.test(input.tool_name || "")) {
    return passThrough("not-a-spawn-event");
  }

  const toolInput = input.tool_input || {};
  const subagentType = typeof toolInput.subagent_type === "string" ? toolInput.subagent_type : null;
  if (subagentType && READ_ONLY_SPAWNS.has(subagentType)) return passThrough("read-only-spawn");

  const task = (typeof toolInput.prompt === "string" && toolInput.prompt) || toolInput.description || "";
  if (!task || task.includes(ENGINEERED_MARKER)) return passThrough("already-engineered");

  let buildBrief;
  try {
    ({ buildBrief } = await import(join(HOOK_DIR, "..", "dist", "brief.js")));
  } catch {
    return passThrough("dist-missing"); // dev checkout without a build — degrade silently
  }

  let result;
  try {
    result = await buildBrief({
      task,
      agent: null,
      subagentType,
      mapDir: join(homedir(), ".invoker", "map"),
      statePath: join(homedir(), ".invoker", "state", "promper-decision.json"),
      json: true,
    });
  } catch (err) {
    return passThrough(`brief-failed: ${err.message}`); // spawn with the original brief
  }

  if (result.noop) return passThrough(`noop: ${result.note || "no value to add"}`);

  debug("rewrote", { subagentType, row: result.row, agent: result.agent });

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...toolInput, prompt: result.prompt },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
