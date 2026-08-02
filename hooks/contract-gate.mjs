#!/usr/bin/env node
// PreToolUse hook (matcher "Edit|Write|MultiEdit|NotebookEdit") — the contract gate.
//
// The SessionStart injection (inject-contract.mjs) is advisory text the model can drift away
// from as context grows. This hook is the enforcement: a repo-file edit is denied until a
// fresh routing decision exists at ~/.invoker/state/promper-decision-<session_id>.json (same
// repo, 60-min TTL — the same freshness rules brief.ts uses for role inheritance). The denial
// message re-delivers the contract at the moment it matters and hands back the exact JSON to
// write. Decisions are session-scoped so concurrent sessions never clobber each other; the
// legacy global promper-decision.json is accepted as a permanent fallback (Codex and other
// environments without a session_id on the hook payload write there).
//
// Deadlock-free by scope: only targets INSIDE the active repo root are gated. The state file
// lives in ~/.invoker/state/ — outside every repo — so recording the decision always passes,
// as does any other out-of-repo write.
//
// Verdict semantics: hooks also fire inside subagents, and a subagent's edit is
// indistinguishable from the main model's here. So the gate accepts a fresh decision of ANY
// verdict (inline/agent/mixed) rather than blocking verdict "agent" edits — otherwise the
// spawned specialist doing the routed work would be locked out of the repo.
//
// Fail-open everywhere: any parse error, missing field we can't interpret, or unexpected
// condition passes the tool call through. A broken gate must degrade to "no gate", never to
// "no editing".
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, no gating).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const STATE_DIR = join(homedir(), ".invoker", "state");
const LEGACY_STATE_PATH = join(STATE_DIR, "promper-decision.json");
const STATE_TTL_MS = 60 * 60 * 1000; // matches STATE_TTL_MS in src/brief.ts
const GATED_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/;

function patchTargets(command) {
  if (typeof command !== "string") return [];
  return [...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm), ...command.matchAll(/^\*\*\* Move to: (.+)$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}
const VERDICTS = new Set(["inline", "agent", "mixed"]);

function passThrough() {
  process.exit(0);
}

/** Session-scoped decision path; legacy global fallback. Keep in sync across hooks/*.mjs. */
function decisionPath(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? join(STATE_DIR, `promper-decision-${sessionId}.json`)
    : LEGACY_STATE_PATH;
}

/** Same repo-root resolution as src/brief.ts: git toplevel, cwd fallback outside a repo. */
function gitRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const top = result.status === 0 ? result.stdout.trim() : "";
  return top || process.cwd();
}

/** True when a fresh, same-repo routing decision exists at any of the candidate paths. */
function decisionSatisfies(repoRoot, paths) {
  for (const path of paths) {
    let decision;
    try {
      decision = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (typeof decision.verdict !== "string" || !VERDICTS.has(decision.verdict)) continue;
    if (typeof decision.repo !== "string" || resolve(decision.repo) !== resolve(repoRoot)) continue;
    if (typeof decision.ts !== "number" || Date.now() - decision.ts > STATE_TTL_MS) continue;
    return true;
  }
  return false;
}

function denyMessage(repoRoot, statePath) {
  return (
    "promper contract gate: no fresh routing decision for this repo — direct repo edits are " +
    "gated until the promper agent-walk has run (see the promper orchestration contract " +
    "injected at session start; full logic: skills/promper/SKILL.md).\n\n" +
    "1. Decompose the task inline, route via ~/.invoker/map (index.json -> <domain>.json), " +
    "inherit the specialist's persona. Never invent a role.\n" +
    "2. Record the decision (this write is NOT gated — the state dir is outside the repo):\n" +
    `   Write ${statePath} with\n` +
    `   {"verdict":"inline"|"agent"|"mixed","repo":"${repoRoot}","agent":"<routed agent name, if any>","reason":"<one line>","ts":<epoch ms>}\n` +
    "3. Retry the edit. Decisions expire after 60 minutes, are keyed to this repo root, and " +
    "are scoped to this session.\n\n" +
    "Off switch for all promper hooks: PROMPER_ACTIVE=0."
  );
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
  if (input.hook_event_name !== "PreToolUse" || !GATED_TOOLS.test(input.tool_name || "")) {
    return passThrough();
  }

  const toolInput = input.tool_input || {};
  const repoRoot = gitRoot();
  const targets = [
    (typeof toolInput.file_path === "string" && toolInput.file_path) ||
      (typeof toolInput.notebook_path === "string" && toolInput.notebook_path) ||
      "",
    ...patchTargets(toolInput.command),
  ].filter(Boolean);
  if (targets.length === 0) return passThrough(); // can't tell what's being written — fail open

  const touchesRepo = targets.some((target) => {
    const rel = relative(repoRoot, resolve(process.cwd(), target));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
  if (!touchesRepo) return passThrough(); // out-of-repo writes (incl. the state file) are never gated

  const sessionPath = decisionPath(input.session_id);
  const candidates = sessionPath === LEGACY_STATE_PATH ? [sessionPath] : [sessionPath, LEGACY_STATE_PATH];
  if (decisionSatisfies(repoRoot, candidates)) return passThrough();

  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: denyMessage(repoRoot, sessionPath),
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch(passThrough); // fail open, always
