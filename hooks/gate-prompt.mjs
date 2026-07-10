#!/usr/bin/env node
// UserPromptSubmit hook — promper's "deep dive but not follow-up" trigger.
// Deterministic classify (src/gate.ts), no LLM. On "deep", nudges the main model to run the
// promper agent-walk before answering and to persist the routed agent, so the PreToolUse
// spawn hook (enrich-spawn.mjs) can inherit that role automatically. On "follow-up", says
// nothing — never nags on an ordinary continuation.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no injection).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

const NUDGE =
  "This looks like a new substantial task. Before answering, run the promper agent-walk " +
  "(decompose inline -> route via ~/.invoker/map -> inherit the specialist's persona -> " +
  "engineer the prompt) per the promper skill. If you route to a specialist agent, record it " +
  "at ~/.invoker/state/promper-decision.json (verdict, repo, agent, reason, ts) so downstream " +
  "subagent spawns inherit that role automatically.";

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
  if (input.hook_event_name !== "UserPromptSubmit") return passThrough();

  let countPriorUserTurns, classifyGate;
  try {
    ({ countPriorUserTurns, classifyGate } = await import(join(HOOK_DIR, "..", "dist", "gate.js")));
  } catch {
    return passThrough(); // dev checkout without a build — degrade silently
  }

  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : null;
  const priorTurns = await countPriorUserTurns(transcriptPath);
  const verdict = classifyGate(priorTurns, prompt);

  if (verdict !== "deep") return passThrough();

  // Re-inject the full contract alongside the nudge: the SessionStart copy decays as context
  // grows (or is summarized away), and a deep prompt is exactly when it must be in reach.
  let contract = "";
  try {
    contract = readFileSync(join(HOOK_DIR, "contract.md"), "utf8").trim();
  } catch {
    /* contract.md missing — the nudge alone still stands */
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: contract ? `${NUDGE}\n\n${contract}` : NUDGE,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
