#!/usr/bin/env node
// `node tools/check-hooks.mjs` — dependency-free behavioral checks for the hook scripts.
//
// Spawns each hook exactly the way Claude Code does (stdin JSON, stdout JSON, exit code) with
// HOME pointed at a scratch dir, so the session-scoped decision-file behavior is exercised
// against a throwaway ~/.invoker/state without touching real state. Exits 1 on any failure.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, existsSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = join(ROOT, "hooks");

// realpath: macOS tmpdir is a symlink (/var -> /private/var); git rev-parse reports the real
// path, so the scratch repos must be addressed by it or every containment check misfires.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "promper-check-")));
const home = join(scratch, "home");
const stateDir = join(home, ".invoker", "state");
mkdirSync(stateDir, { recursive: true });

// A scratch git repo so gitRoot() resolves deterministically for the gated-edit tests.
const repoA = join(scratch, "repoA");
mkdirSync(repoA, { recursive: true });
spawnSync("git", ["init", "-q", repoA]);
const repoB = join(scratch, "repoB");
mkdirSync(repoB, { recursive: true });
spawnSync("git", ["init", "-q", repoB]);

const LEGACY = join(stateDir, "promper-decision.json");
const sessionFile = (id) => join(stateDir, `promper-decision-${id}.json`);
const decision = (repo, extra = {}) =>
  JSON.stringify({ verdict: "inline", repo, agent: "", reason: "check", ts: Date.now(), ...extra });

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function runHook(script, stdinObj, { cwd = repoA, env = {} } = {}) {
  const result = spawnSync("node", [join(HOOKS, script)], {
    cwd,
    input: JSON.stringify(stdinObj),
    encoding: "utf8",
    env: { ...process.env, HOME: home, PROMPER_ACTIVE: "1", ...env },
  });
  let out = null;
  try {
    out = JSON.parse(result.stdout);
  } catch {
    /* hooks that pass through print nothing */
  }
  return { status: result.status, stdout: result.stdout, out };
}

const editEvent = (sessionId, filePath = join(repoA, "src", "x.ts")) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  tool_input: { file_path: filePath },
  ...(sessionId ? { session_id: sessionId } : {}),
});

console.log("contract-gate.mjs");
{
  // 1. No decision anywhere → deny, message names the session-scoped path.
  let r = runHook("contract-gate.mjs", editEvent("S1"));
  const deny = r.out?.hookSpecificOutput?.permissionDecision === "deny";
  const reason = r.out?.hookSpecificOutput?.permissionDecisionReason || "";
  check("denies without decision", deny);
  check("deny message names session path", reason.includes(sessionFile("S1")));

  // 2. Fresh same-repo decision in the session file → allow (silent pass-through).
  writeFileSync(sessionFile("S1"), decision(repoA));
  r = runHook("contract-gate.mjs", editEvent("S1"));
  check("allows with fresh session decision", r.status === 0 && r.out === null, r.stdout);

  // 3. Another session's file never satisfies this session.
  rmSync(sessionFile("S1"));
  writeFileSync(sessionFile("S2"), decision(repoA));
  r = runHook("contract-gate.mjs", editEvent("S1"));
  check("ignores another session's decision", r.out?.hookSpecificOutput?.permissionDecision === "deny");
  rmSync(sessionFile("S2"));

  // 4. Legacy global fallback still satisfies the gate.
  writeFileSync(LEGACY, decision(repoA));
  r = runHook("contract-gate.mjs", editEvent("S1"));
  check("legacy fallback allows", r.status === 0 && r.out === null, r.stdout);

  // 5. Wrong-repo decision never satisfies.
  writeFileSync(LEGACY, decision(repoB));
  r = runHook("contract-gate.mjs", editEvent("S1"));
  check("wrong-repo decision denies", r.out?.hookSpecificOutput?.permissionDecision === "deny");

  // 6. Expired decision never satisfies.
  writeFileSync(sessionFile("S1"), decision(repoA, { ts: Date.now() - 61 * 60 * 1000 }));
  rmSync(LEGACY);
  r = runHook("contract-gate.mjs", editEvent("S1"));
  check("expired decision denies", r.out?.hookSpecificOutput?.permissionDecision === "deny");
  rmSync(sessionFile("S1"));

  // 7. No session_id on the payload → legacy path drives both deny message and allow.
  r = runHook("contract-gate.mjs", editEvent(null));
  check(
    "no session_id: deny names legacy path",
    (r.out?.hookSpecificOutput?.permissionDecisionReason || "").includes(LEGACY)
  );
  writeFileSync(LEGACY, decision(repoA));
  r = runHook("contract-gate.mjs", editEvent(null));
  check("no session_id: legacy decision allows", r.status === 0 && r.out === null, r.stdout);
  rmSync(LEGACY);

  // 8. Out-of-repo writes are never gated, decision or not.
  r = runHook("contract-gate.mjs", editEvent("S1", join(stateDir, "promper-decision-S1.json")));
  check("out-of-repo write passes", r.status === 0 && r.out === null, r.stdout);

  // 9. PROMPER_ACTIVE=0 disables the gate.
  r = runHook("contract-gate.mjs", editEvent("S1"), { env: { PROMPER_ACTIVE: "0" } });
  check("off switch passes through", r.status === 0 && r.out === null, r.stdout);
}

console.log("clear-decision.mjs");
{
  const end = (sessionId) => ({
    hook_event_name: "SessionEnd",
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  // Own file removed; another session's fresh file untouched; stale file swept; legacy kept.
  writeFileSync(sessionFile("S1"), decision(repoA));
  writeFileSync(sessionFile("S2"), decision(repoB));
  writeFileSync(sessionFile("S3"), decision(repoA));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(sessionFile("S3"), old, old);
  writeFileSync(LEGACY, decision(repoB));

  const r = runHook("clear-decision.mjs", end("S1"));
  check("exits clean", r.status === 0, r.stdout);
  check("removes own session file", !existsSync(sessionFile("S1")));
  check("keeps another session's fresh file", existsSync(sessionFile("S2")));
  check("sweeps stale session file", !existsSync(sessionFile("S3")));
  check("session_id present: legacy file untouched", existsSync(LEGACY));
  rmSync(sessionFile("S2"));

  // No session_id → legacy repo-scoped rule: same-repo decision cleared, other-repo kept.
  writeFileSync(LEGACY, decision(repoB));
  runHook("clear-decision.mjs", end(null), { cwd: repoA });
  check("no session_id: other-repo legacy kept", existsSync(LEGACY));
  runHook("clear-decision.mjs", end(null), { cwd: repoB });
  check("no session_id: same-repo legacy cleared", !existsSync(LEGACY));
}

console.log("inject-contract.mjs");
{
  const start = (sessionId) => ({
    hook_event_name: "SessionStart",
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  let r = runHook("inject-contract.mjs", start("S1"));
  let ctx = r.out?.hookSpecificOutput?.additionalContext || "";
  check("session path substituted", ctx.includes(sessionFile("S1")));
  check("anchor literal fully replaced", !ctx.includes("~/.invoker/state/promper-decision.json"));

  r = runHook("inject-contract.mjs", start(null));
  ctx = r.out?.hookSpecificOutput?.additionalContext || "";
  check("no session_id: anchor literal intact", ctx.includes("~/.invoker/state/promper-decision.json"));
}

console.log("gate-prompt.mjs");
{
  // Session opener (no transcript → zero prior turns) always classifies "deep".
  const submit = (sessionId) => ({
    hook_event_name: "UserPromptSubmit",
    prompt: "build a full authentication system for the api",
    ...(sessionId ? { session_id: sessionId } : {}),
  });
  let r = runHook("gate-prompt.mjs", submit("S1"));
  let ctx = r.out?.hookSpecificOutput?.additionalContext || "";
  check("nudge fires on deep prompt", ctx.length > 0);
  check("session path substituted", ctx.includes(sessionFile("S1")));
  check("anchor literal fully replaced", !ctx.includes("~/.invoker/state/promper-decision.json"));

  r = runHook("gate-prompt.mjs", submit(null));
  ctx = r.out?.hookSpecificOutput?.additionalContext || "";
  check("no session_id: anchor literal intact", ctx.includes("~/.invoker/state/promper-decision.json"));
}

console.log("enrich-spawn.mjs");
{
  // Scratch HOME has no map — the hook must degrade to a silent pass-through, not crash.
  const spawn = {
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { prompt: "investigate the failing build", subagent_type: "general-purpose" },
    session_id: "S1",
  };
  writeFileSync(sessionFile("S1"), decision(repoA, { agent: "backend-developer" }));
  const r = runHook("enrich-spawn.mjs", spawn);
  check("no-map spawn never crashes", r.status === 0, r.stdout);
  rmSync(sessionFile("S1"));
}

rmSync(scratch, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
