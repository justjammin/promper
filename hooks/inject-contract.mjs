#!/usr/bin/env node
// SessionStart hook — injects the promper orchestration contract (hooks/contract.md) as
// standing context, so this behavior doesn't need to live in the user's personal
// ~/.claude/CLAUDE.md. Fires on every session start (startup/resume/compact/clear).
//
// The contract's decision-file path is session-scoped: the legacy literal in contract.md is a
// substitution anchor replaced with this session's concrete path, so concurrent sessions never
// share a decision slot. No session_id on the payload → the literal (still a valid fallback
// path the gate accepts) is injected unchanged.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no injection).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(homedir(), ".invoker", "state");
const LEGACY_STATE_PATH = join(STATE_DIR, "promper-decision.json");
// The exact literal contract.md uses for the decision file — the substitution anchor.
const STATE_PATH_ANCHOR = "~/.invoker/state/promper-decision.json";

/** Session-scoped decision path; legacy global fallback. Keep in sync across hooks/*.mjs. */
function decisionPath(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? join(STATE_DIR, `promper-decision-${sessionId}.json`)
    : LEGACY_STATE_PATH;
}

function passThrough() {
  process.exit(0);
}

async function main() {
  if (process.env.PROMPER_ACTIVE === "0") return passThrough();

  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return passThrough();
  }
  if (input.hook_event_name !== "SessionStart") return passThrough();

  let contract;
  try {
    contract = readFileSync(join(HOOK_DIR, "contract.md"), "utf8").trim();
  } catch {
    return passThrough(); // contract.md missing from this install — degrade silently
  }

  const sessionPath = decisionPath(input.session_id);
  if (sessionPath !== LEGACY_STATE_PATH) {
    contract = contract.replaceAll(STATE_PATH_ANCHOR, sessionPath);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: contract,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
