#!/usr/bin/env node
// `promper-setup-runner` — wires promper's UserPromptSubmit hook into Claude Code so
// every bare prompt is routed through `/promper <intent> --run`, and REPLACES any
// invokerai prompt-submit hook so promper owns the routing.
//
// What it does:
//   1. Copies the hooks/ tree (dispatcher + lib/ + sources/) to a stable path
//      (~/.claude/promper/hooks/) so settings can point at an absolute location.
//   2. Reads the target settings.json (user-wide by default, or project with --project),
//      backing it up first.
//   3. Strips any existing invokerai prompt-submit hook (command referencing "invoker")
//      AND any prior promper hook (idempotent re-runs).
//   4. Adds the promper UserPromptSubmit hook.
//
// Usage:
//   promper-setup-runner                # install into ~/.claude/settings.json
//   promper-setup-runner --project      # install into ./.claude/settings.json
//   promper-setup-runner --uninstall    # remove promper's hook (and leave invokerai's removed)
//   promper-setup-runner --keep-invoker # do not strip invokerai's prompt-submit hook

import { cp, mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const PROJECT = flag("--project");
const UNINSTALL = flag("--uninstall");
const KEEP_INVOKER = flag("--keep-invoker");

const HOOK_TAG = "promper:prompt-submit"; // marker so we can find/replace our own entry
const INVOKER_RE = /invoker/i; // matches invokerai hooks to strip

const settingsPath = PROJECT
  ? join(process.cwd(), ".claude", "settings.json")
  : join(home, ".claude", "settings.json");

// Stable home for the hook tree so settings can reference an absolute path. The hook is a
// dispatcher that imports sibling modules (lib/, sources/), so we copy the whole tree.
const hookHome = join(home, ".claude", "promper");
const hookDir = join(hookHome, "hooks");
const hookEntry = join(hookDir, "prompt-submit.mjs");
const hookCommand = `node ${hookEntry}`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p, fallback) {
  if (!(await exists(p))) return fallback;
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch (err) {
    throw new Error(`could not parse ${p}: ${err.message}`);
  }
}

// A UserPromptSubmit hook block is { hooks: [ { type, command }, ... ] } (no matcher).
// Returns true if the block contains a command matching `re`.
function blockMatches(block, re) {
  const hooks = Array.isArray(block?.hooks) ? block.hooks : [];
  return hooks.some((h) => typeof h?.command === "string" && re.test(h.command));
}

function makeBlock() {
  return {
    hooks: [{ type: "command", command: hookCommand, _tag: HOOK_TAG }],
  };
}

async function backup(p) {
  if (!(await exists(p))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${p}.${stamp}.bak`;
  await copyFile(p, bak);
  return bak;
}

async function main() {
  const settings = await readJson(settingsPath, {});
  settings.hooks = settings.hooks || {};
  const list = Array.isArray(settings.hooks.UserPromptSubmit)
    ? settings.hooks.UserPromptSubmit
    : [];

  // Always strip a prior promper entry so re-runs are idempotent.
  // Strip invokerai's entry unless --keep-invoker. On --uninstall we strip ours only.
  let stripped = 0;
  const ours = (b) =>
    blockMatches(b, new RegExp(HOOK_TAG)) ||
    (b?.hooks || []).some((h) => h?._tag === HOOK_TAG) ||
    blockMatches(b, /prompt-submit\.mjs/);
  const invoker = (b) => blockMatches(b, INVOKER_RE);

  let next = list.filter((b) => {
    if (ours(b)) {
      stripped++;
      return false;
    }
    if (!UNINSTALL && !KEEP_INVOKER && invoker(b)) {
      stripped++;
      return false;
    }
    return true;
  });

  if (UNINSTALL) {
    settings.hooks.UserPromptSubmit = next;
    if (next.length === 0) delete settings.hooks.UserPromptSubmit;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
    const bak = await backup(settingsPath);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(`  removed  promper hook from  ${settingsPath}`);
    if (bak) console.log(`  backup   ${bak}`);
    console.log("\n  Uninstalled. Restart Claude Code.\n");
    return;
  }

  // Install the hook tree to its stable home (dispatcher + lib/ + sources/).
  await mkdir(hookHome, { recursive: true });
  await cp(join(root, "hooks"), hookDir, { recursive: true, force: true });

  next.push(makeBlock());
  settings.hooks.UserPromptSubmit = next;

  await mkdir(dirname(settingsPath), { recursive: true });
  const bak = await backup(settingsPath);

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  console.log(`  installed  hook tree   →  ${hookDir}`);
  console.log(`  wired      UserPromptSubmit  →  ${settingsPath}`);
  if (stripped) console.log(`  replaced   ${stripped} existing prompt-submit hook(s)`);
  if (bak) console.log(`  backup     ${bak}`);

  // Nudge if the skills/agent-map aren't present — the run flow depends on them.
  const skill = join(home, ".claude", "skills", "promper");
  if (!(await exists(skill))) {
    console.warn(
      "\n  ⚠  promper skill not found at ~/.claude/skills/promper.\n" +
        "     Run `npx @ninjamin/promper` first so /promper resolves."
    );
  }
  const agentMap = join(home, ".invoker", "agent-map.json");
  if (!(await exists(agentMap))) {
    console.warn(
      "\n  ⚠  invokerai agent map not found at ~/.invoker/agent-map.json.\n" +
        "     --run routing inherits roles from invokerai; install it first."
    );
  }

  console.log(
    "\n  Done. Restart Claude Code. Every prompt now routes through `/promper … --run`.\n" +
      "  Append `--raw` to a prompt to bypass once; run with `--uninstall` to remove.\n"
  );
}

main().catch((err) => {
  console.error(`\n  setup-runner failed: ${err.message}\n`);
  process.exit(1);
});
