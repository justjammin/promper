#!/usr/bin/env node
// SessionEnd hook — re-arms the contract gate for the next session by clearing this session's
// routing decision at ~/.invoker/state/promper-decision-<session_id>.json. Without this, a
// decision written near session end would carry its remaining TTL into a fresh session,
// letting the next session's first edits skip the agent-walk.
//
// Session-scoped on purpose: each session owns its own decision file, so a session ending in
// repo A never wipes a decision an active session (same repo or not) still needs. Only when
// the hook payload carries no session_id does the legacy global promper-decision.json apply,
// and there the old repo-scoped rule holds: remove it only when its `repo` matches this
// session's repo root (or the file is unparseable).
//
// Either way, finish with a bounded sweep of stale session-scoped files (mtime past the gate
// TTL) so abandoned sessions don't accumulate dead state files.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, nothing cleared).

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const STATE_DIR = join(homedir(), ".invoker", "state");
const LEGACY_STATE_PATH = join(STATE_DIR, "promper-decision.json");
const STATE_TTL_MS = 60 * 60 * 1000; // matches contract-gate.mjs / src/brief.ts

/** Session-scoped decision path; legacy global fallback. Keep in sync across hooks/*.mjs. */
function decisionPath(sessionId) {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(sessionId)
    ? join(STATE_DIR, `promper-decision-${sessionId}.json`)
    : LEGACY_STATE_PATH;
}

/** Unlink session-scoped decision files whose mtime is past the TTL (the gate would reject
 * them anyway). mtime, not the `ts` field, so unparseable files age out too. */
function sweepStale() {
  try {
    for (const name of readdirSync(STATE_DIR)) {
      if (!/^promper-decision-.+\.json$/.test(name)) continue;
      const path = join(STATE_DIR, name);
      try {
        if (Date.now() - statSync(path).mtimeMs > STATE_TTL_MS) unlinkSync(path);
      } catch {
        /* raced away or unreadable — skip */
      }
    }
  } catch {
    /* state dir missing — nothing to sweep */
  }
}

function passThrough() {
  process.exit(0);
}

function gitRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const top = result.status === 0 ? result.stdout.trim() : "";
  return top || process.cwd();
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
  if (input.hook_event_name !== "SessionEnd") return passThrough();

  const sessionPath = decisionPath(input.session_id);
  if (sessionPath !== LEGACY_STATE_PATH) {
    // Session-owned file — no repo check needed, nothing else can depend on it.
    try {
      unlinkSync(sessionPath);
    } catch {
      /* already gone, or unwritable — nothing to enforce */
    }
  } else {
    // No session_id on the payload — legacy global slot, keep the repo-scoped rule.
    let sameRepo = true; // unreadable/corrupt file → clear it anyway
    try {
      const decision = JSON.parse(readFileSync(LEGACY_STATE_PATH, "utf8"));
      if (typeof decision.repo === "string") {
        sameRepo = resolve(decision.repo) === resolve(gitRoot());
      }
    } catch {
      /* fall through with sameRepo = true */
    }
    if (sameRepo) {
      try {
        unlinkSync(LEGACY_STATE_PATH);
      } catch {
        /* already gone, or unwritable — nothing to enforce */
      }
    }
  }

  sweepStale();
  process.exit(0);
}

main().catch(passThrough);
