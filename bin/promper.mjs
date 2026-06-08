#!/usr/bin/env node
// `npx promper` — copies the promper + prim skills into ~/.claude/skills/.
// npx runs from a throwaway cache, so we COPY (not symlink, which the repo uses for local dev).

import { cp, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SKILLS = ["promper", "prim"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(homedir(), ".claude", "skills");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function main() {
  await mkdir(dest, { recursive: true });

  for (const name of SKILLS) {
    const from = join(root, "skills", name);
    const to = join(dest, name);
    await cp(from, to, { recursive: true, force: true });
    console.log(`  installed  ${name}  →  ${to}`);
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
