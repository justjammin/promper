#!/usr/bin/env node
// promper decision-gate hook — deterministic.
//
// One file, three hook events plus a tiny grant CLI:
//   SessionStart      → inject the routing digest + the prompt-engineering mandate.
//   UserPromptSubmit  → inject the mandate on EVERY prompt (every question and
//                       coding decision gets proper prompt engineering).
//   PreToolUse        → HARD GATE on Agent/Task spawns: deny unless a spawn
//                       grant exists. Grants are minted by the promper flow
//                       itself, so the engineering step is the authorization.
//
// CLI (used by the promper skill, or manually):
//   --grant [N]   mint N spawn grants (default 1)
//   --revoke      clear all grants
//   --status      print gate mode + outstanding grants
//
// Design contract:
//   - Deterministic: output is a pure function of (event, agent map, prim
//     ledger, grant files, config). No timestamps, no TTL clocks, no env
//     probing; JSON via JSON.stringify, never hand-escaped shell strings.
//   - Grants are count-based one-shot files consumed by atomic unlink — no
//     30-second race like the old bash token gate, and parallel spawns each
//     consume their own grant.
//   - Denies exit 0 with hookSpecificOutput JSON (exit-nonzero denies are
//     ignored by Claude Code — the old hook's enforcement bug).
//   - Fails open only on malformed stdin; a missing grants dir fails CLOSED
//     for spawns (that is the point of the gate).
//   - Gate mode via ~/.promper/config.json {"gate": "hard"|"advisory"|"off"},
//     default "hard".

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_CONTEXT = 1500;
const MAX_DOMAINS = 8;

const AGENT_MAP_PATH = join(homedir(), ".invoker", "agent-map.json");
const PRIM_LEDGER_PATH = join(homedir(), ".claude", "agents", ".prim-seal.json");
const PROMPER_DIR = join(homedir(), ".promper");
const GRANTS_DIR = join(PROMPER_DIR, "grants");
const CONFIG_PATH = join(PROMPER_DIR, "config.json");

const SPAWN_TOOLS = new Set(["Agent", "Task"]);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function gateMode() {
  const config = readJson(CONFIG_PATH);
  const gate = config && typeof config === "object" ? config.gate : undefined;
  return gate === "advisory" || gate === "off" ? gate : "hard";
}

// ---------- grants ----------

function grantCount() {
  try {
    return readdirSync(GRANTS_DIR).filter((n) => n.startsWith("grant-")).length;
  } catch {
    return 0;
  }
}

function mintGrants(n) {
  mkdirSync(GRANTS_DIR, { recursive: true });
  let minted = 0;
  // lowest free indices; "wx" refuses to clobber a live grant
  for (let i = 1; minted < n && i < n + 1000; i++) {
    try {
      writeFileSync(join(GRANTS_DIR, `grant-${i}`), "", { flag: "wx" });
      minted++;
    } catch {}
  }
  return minted;
}

function revokeGrants() {
  let revoked = 0;
  try {
    for (const name of readdirSync(GRANTS_DIR)) {
      if (!name.startsWith("grant-")) continue;
      try {
        unlinkSync(join(GRANTS_DIR, name));
        revoked++;
      } catch {}
    }
  } catch {}
  return revoked;
}

// unlink is atomic: with N grants and M concurrent spawns, exactly
// min(N, M) succeed — no read-modify-write race.
function consumeGrant() {
  let names;
  try {
    names = readdirSync(GRANTS_DIR).filter((n) => n.startsWith("grant-")).sort();
  } catch {
    return false;
  }
  for (const name of names) {
    try {
      unlinkSync(join(GRANTS_DIR, name));
      return true;
    } catch {}
  }
  return false;
}

// ---------- context ----------

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

function mapDigestLines() {
  const domains = domainCounts(readJson(AGENT_MAP_PATH));
  if (domains.length === 0) {
    return [
      "- agent map: MISSING (~/.invoker/agent-map.json) — run /invokerai:setup; roles fall back to generic experts until it exists",
    ];
  }
  const total = domains.reduce((n, [, c]) => n + c, 0);
  const shown = domains.slice(0, MAX_DOMAINS);
  const more = domains.length > MAX_DOMAINS ? `, +${domains.length - MAX_DOMAINS} more` : "";
  const lines = [
    `- agent map: ${total} agent${total === 1 ? "" : "s"} across ${domains.length} domain${domains.length === 1 ? "" : "s"} — ${shown.map(([d, c]) => `${d} (${c})`).join(", ")}${more}`,
  ];
  const prim = primStats(readJson(PRIM_LEDGER_PATH));
  if (prim) {
    lines.push(
      `- prim ledger: ${prim.sealed} sealed, ${prim.needWork} need work — warn before inheriting a role from an unsealed agent`
    );
  }
  return lines;
}

function mandateLines(mode) {
  const lines = [
    "promper decision gate — every question and coding decision gets proper prompt engineering:",
    "- apply reference/pe-principles.md before answering or deciding: explicit objective, structure, constraints, output format; state assumptions; \"I don't know\" is allowed",
    "- subagent work routes through invokerai to inherit the agent's role (/promper flow) — roles are inherited, never invented",
  ];
  if (mode === "hard") {
    lines.push(
      "- HARD GATE: raw Agent/Task spawns are DENIED without a spawn grant; the promper flow mints grants after the task is engineered"
    );
  }
  return lines;
}

function emit(hookEventName, fields) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName, ...fields } })
  );
}

function emitContext(hookEventName, lines) {
  emit(hookEventName, {
    additionalContext: lines.join("\n").slice(0, MAX_CONTEXT),
  });
}

// ---------- entry points ----------

function runCli(args) {
  if (args.includes("--revoke")) {
    console.log(`promper gate: revoked ${revokeGrants()} grant(s)`);
    return;
  }
  if (args.includes("--status")) {
    console.log(`promper gate: mode=${gateMode()} grants=${grantCount()}`);
    return;
  }
  const i = args.indexOf("--grant");
  const parsed = Number.parseInt(args[i + 1], 10);
  const n = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  mintGrants(n);
  console.log(`promper gate: ${grantCount()} grant(s) outstanding`);
}

function handleEvent(event, mode) {
  switch (event.hook_event_name) {
    case "SessionStart":
      // A resumed session already carries the digest.
      if (event.source === "resume") return;
      emitContext("SessionStart", [...mandateLines(mode), ...mapDigestLines()]);
      return;

    case "UserPromptSubmit":
      // Unconditional: the mandate rides along with every prompt.
      emitContext("UserPromptSubmit", mandateLines(mode));
      return;

    case "PreToolUse": {
      if (!SPAWN_TOOLS.has(event.tool_name)) return;
      if (mode !== "hard") return;
      if (consumeGrant()) return; // engineered spawn — fall through to normal permissions
      emit("PreToolUse", {
        permissionDecision: "deny",
        permissionDecisionReason:
          "promper decision gate: no spawn grant. Engineer this task first — " +
          "route it via invokerai (decompose + spawn selection), inherit the selected agent's role, " +
          "and craft the brief per reference/pe-principles.md (the /promper flow). " +
          `Then mint grants and retry: node "${process.argv[1]}" --grant <number-of-agents>. ` +
          mapDigestLines().join(" "),
      });
      return;
    }

    default:
      return;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--grant") || args.includes("--revoke") || args.includes("--status")) {
    runCli(args);
    return;
  }

  const mode = gateMode();
  if (mode === "off") return;

  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  handleEvent(event, mode);
}

main();
