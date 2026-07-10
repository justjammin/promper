#!/usr/bin/env node
// SessionStart hook — injects the promper orchestration contract (hooks/contract.md) as
// standing context, so this behavior doesn't need to live in the user's personal
// ~/.claude/CLAUDE.md. Fires on every session start (startup/resume/compact/clear).
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no injection).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

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
