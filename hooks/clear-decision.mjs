#!/usr/bin/env node
// SessionEnd hook — re-arms the contract gate for the next session by clearing this repo's
// routing decision at ~/.invoker/state/promper-decision.json. Without this, a decision written
// near session end would carry its remaining TTL into a fresh session, letting the next
// session's first edits skip the agent-walk.
//
// Repo-scoped on purpose: the state file is a single global slot, so a session ending in repo
// A must not wipe a decision an active session in repo B just recorded. Only a decision whose
// `repo` matches this session's repo root (or an unparseable file) is removed.
//
// Off switch: PROMPER_ACTIVE=0 disables this hook (pass-through, nothing cleared).

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const STATE_PATH = join(homedir(), ".invoker", "state", "promper-decision.json");

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

  let sameRepo = true; // unreadable/corrupt file → clear it anyway
  try {
    const decision = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (typeof decision.repo === "string") {
      sameRepo = resolve(decision.repo) === resolve(gitRoot());
    }
  } catch {
    /* fall through with sameRepo = true */
  }

  if (sameRepo) {
    try {
      unlinkSync(STATE_PATH);
    } catch {
      /* already gone, or unwritable — nothing to enforce */
    }
  }
  process.exit(0);
}

main().catch(passThrough);
