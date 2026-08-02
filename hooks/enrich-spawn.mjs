#!/usr/bin/env node
// PreToolUse hook (matcher "Agent|Task") — promper's "on any subagent spawn" trigger.
// Deterministic: rewrites tool_input.prompt to a role-bearing brief before the subagent
// spawns. Never calls an LLM. See `promper brief` (src/brief.ts) for the precedence table.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no mutation).

import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const READ_ONLY_SPAWNS = new Set(["Explore", "Plan"]);
const ENGINEERED_MARKER = "<instructions>";
const STATE_DIR = join(homedir(), ".invoker", "state");
const LEGACY_STATE_PATH = join(STATE_DIR, "promper-decision.json");

/** Session-scoped decision path; legacy global fallback. Keep in sync across hooks/*.mjs. */
function decisionPath(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? join(STATE_DIR, `promper-decision-${sessionId}.json`)
    : LEGACY_STATE_PATH;
}

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

  if (input.hook_event_name !== "PreToolUse" || !/^(Agent|Task|spawn_agent)$/.test(input.tool_name || "")) {
    return passThrough("not-a-spawn-event");
  }

  const toolInput = input.tool_input || {};
  const rawSubagentType =
    (typeof toolInput.subagent_type === "string" && toolInput.subagent_type) ||
    (typeof toolInput.agent_type === "string" && toolInput.agent_type) ||
    null;
  const subagentType = rawSubagentType === "default" ? null : rawSubagentType;
  if (subagentType && READ_ONLY_SPAWNS.has(subagentType)) return passThrough("read-only-spawn");

  const promptField = typeof toolInput.message === "string" ? "message" : "prompt";
  const task =
    (typeof toolInput[promptField] === "string" && toolInput[promptField]) ||
    toolInput.description ||
    "";
  if (!task || task.includes(ENGINEERED_MARKER)) return passThrough("already-engineered");

  let buildBrief;
  try {
    ({ buildBrief } = await import(join(HOOK_DIR, "..", "dist", "brief.js")));
  } catch {
    return passThrough("dist-missing"); // dev checkout without a build — degrade silently
  }

  // Prefer this session's decision file; fall back to the legacy global slot when the
  // session-scoped file was never written (older contract text, Codex, no session_id).
  const sessionPath = decisionPath(input.session_id);
  const statePath =
    sessionPath !== LEGACY_STATE_PATH && existsSync(sessionPath) ? sessionPath : LEGACY_STATE_PATH;

  let result;
  try {
    result = await buildBrief({
      task,
      agent: null,
      subagentType,
      mapDir: join(homedir(), ".invoker", "map"),
      statePath,
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
      updatedInput: { ...toolInput, [promptField]: result.prompt },
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
