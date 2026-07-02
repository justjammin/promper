#!/usr/bin/env node
// promper additionalContext hook — deterministic, advisory-only.
//
// Reads a Claude Code hook event (SessionStart | UserPromptSubmit) on stdin and
// emits { hookSpecificOutput: { hookEventName, additionalContext } } on stdout.
//
// Design contract:
//   - Pure function of (event, ~/.invoker/agent-map.json, ~/.claude/agents/.prim-seal.json):
//     same inputs → byte-identical output. No timestamps, no randomness, no env probing.
//   - Advisory only: never emits permissionDecision, never blocks a tool call.
//   - Fails open: missing/malformed stdin or data files → exit 0 with no output.
//   - UserPromptSubmit injects only when the prompt is routing/prompt-engineering
//     related, so ordinary turns pay zero context tax.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_CONTEXT = 1500;
const MAX_DOMAINS = 8;
const RELEVANT =
  /(^|\s)\/?(promper|prim)\b|invoker|engineer(ing)?\s+(a\s|this\s|my\s)?prompt|prompt[-\s]engineer/i;

const AGENT_MAP_PATH = join(homedir(), ".invoker", "agent-map.json");
const PRIM_LEDGER_PATH = join(homedir(), ".claude", "agents", ".prim-seal.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// agent-map.json is {domain: [agents]}; agent entries may be strings or
// objects ({name|agent|id, description}). Tolerate a {domains: {...}} wrapper.
function domainCounts(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const src =
    map.domains && typeof map.domains === "object" && !Array.isArray(map.domains)
      ? map.domains
      : map;
  return Object.entries(src)
    .filter(([, v]) => Array.isArray(v))
    .map(([domain, agents]) => [domain, agents.length])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function primStats(ledger) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) return null;
  let sealed = 0;
  let needWork = 0;
  for (const entry of Object.values(ledger)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.pass === true) sealed++;
    else if (entry.pass === false) needWork++;
  }
  return sealed + needWork > 0 ? { sealed, needWork } : null;
}

function buildContext() {
  const domains = domainCounts(readJson(AGENT_MAP_PATH));

  if (domains.length === 0) {
    return (
      "promper: invokerai agent map not found or empty (~/.invoker/agent-map.json). " +
      "/promper falls back to generic roles until it exists — run /invokerai:setup to build it."
    );
  }

  const total = domains.reduce((n, [, c]) => n + c, 0);
  const shown = domains.slice(0, MAX_DOMAINS);
  const more = domains.length > MAX_DOMAINS ? `, +${domains.length - MAX_DOMAINS} more` : "";

  const lines = [
    "promper × invokerai — routing context (advisory):",
    `- agent map: ${total} agent${total === 1 ? "" : "s"} across ${domains.length} domain${domains.length === 1 ? "" : "s"} (~/.invoker/agent-map.json)`,
    `- domains: ${shown.map(([d, c]) => `${d} (${c})`).join(", ")}${more}`,
  ];

  const prim = primStats(readJson(PRIM_LEDGER_PATH));
  if (prim) {
    lines.push(
      `- prim ledger: ${prim.sealed} sealed, ${prim.needWork} need work — /promper warns when inheriting a role from an unsealed agent`
    );
  }

  lines.push(
    "- /promper <intent> engineers a role-grounded prompt; the <role> is inherited from the invokerai-routed agent, never invented. /prim certifies agents."
  );

  return lines.join("\n");
}

function emit(hookEventName, additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName,
        additionalContext: additionalContext.slice(0, MAX_CONTEXT),
      },
    })
  );
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;

  switch (event.hook_event_name) {
    case "SessionStart":
      // A resumed session already carries the digest; everything else
      // (startup, clear, compact) starts from a fresh or summarized context.
      if (event.source === "resume") return;
      emit("SessionStart", buildContext());
      return;
    case "UserPromptSubmit":
      if (typeof event.prompt !== "string" || !RELEVANT.test(event.prompt)) return;
      emit("UserPromptSubmit", buildContext());
      return;
    default:
      return;
  }
}

main();
