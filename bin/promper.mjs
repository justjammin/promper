#!/usr/bin/env node
// `npx promper` — copies the promper + prim skills into ~/.claude/skills/.
// npx runs from a throwaway cache, so we COPY (not symlink, which the repo uses for local dev).
//
// Flags:
//   --hook   also install the promper decision-gate hook (deterministic JS:
//            SessionStart + UserPromptSubmit context, PreToolUse hard gate on
//            Agent/Task spawns) into ~/.claude/hooks/ and register it in
//            ~/.claude/settings.json (idempotent).

import { cp, mkdir, access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SKILLS = ["promper", "prim"];
const HOOK_FILE = "promper-additional-context.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(homedir(), ".claude", "skills");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function installSkills() {
  await mkdir(dest, { recursive: true });

  for (const name of SKILLS) {
    const from = join(root, "skills", name);
    const to = join(dest, name);
    await cp(from, to, { recursive: true, force: true });
    // Each SKILL.md reads reference/pe-principles.md relative to its own
    // directory, so ship the shared reference alongside every skill copy.
    await mkdir(join(to, "reference"), { recursive: true });
    await cp(
      join(root, "reference", "pe-principles.md"),
      join(to, "reference", "pe-principles.md"),
      { force: true }
    );
    console.log(`  installed  ${name}  →  ${to}`);
  }
}

async function installHook() {
  const hooksDir = join(homedir(), ".claude", "hooks");
  await mkdir(hooksDir, { recursive: true });
  const to = join(hooksDir, HOOK_FILE);
  await cp(join(root, "hooks", "additional-context.mjs"), to, { force: true });
  console.log(`  installed  hook  →  ${to}`);

  const settingsPath = join(homedir(), ".claude", "settings.json");
  let settings = {};
  if (await exists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf8"));
    } catch {
      console.warn(`  ⚠  ${settingsPath} is not valid JSON — hook not registered. Fix the file and re-run with --hook.`);
      return;
    }
  }

  const command = `node "${to}"`;
  const hooks = (settings.hooks ??= {});
  let changed = false;

  const events = [
    ["SessionStart", {}],
    ["UserPromptSubmit", {}],
    ["PreToolUse", { matcher: "^(Agent|Task)$" }],
  ];
  for (const [eventName, extra] of events) {
    const entries = (hooks[eventName] ??= []);
    const present = entries.some((e) =>
      (e.hooks ?? []).some((h) => (h.command ?? "").includes(HOOK_FILE))
    );
    if (!present) {
      entries.push({ ...extra, hooks: [{ type: "command", command }] });
      changed = true;
      console.log(`  registered ${eventName} hook → ${settingsPath}`);
    } else {
      console.log(`  ${eventName} hook already registered (skipped)`);
    }
  }

  if (changed) {
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));

  await installSkills();
  if (args.has("--hook")) {
    await installHook();
  } else {
    console.log("\n  Tip: re-run with --hook to install the promper decision-gate hook.");
  }

  const agentMap = join(homedir(), ".invoker", "agent-map.json");
  if (!(await exists(agentMap))) {
    console.warn(
      "\n  ⚠  invokerai agent map not found at ~/.invoker/agent-map.json.\n" +
      "     promper inherits its <role> from invokerai. Install invokerai and run\n" +
      "     its setup (https://github.com/justjammin/invokerai) before using /promper."
    );
  }

  console.log("\n  Done. Restart Claude Code, then run /promper or /prim.\n");
}

main().catch((err) => {
  console.error(`\n  promper install failed: ${err.message}\n`);
  process.exit(1);
});
