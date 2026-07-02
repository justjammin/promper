#!/usr/bin/env node
// `npx promper` — copies the promper + prim skills into ~/.claude/skills/.
// npx runs from a throwaway cache, so we COPY (not symlink, which the repo uses for local dev).

import { cp, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SKILLS = ["promper", "promper-setup", "prim"];
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

  const mapIndex = join(homedir(), ".invoker", "map", "index.json");
  const legacyMap = join(homedir(), ".invoker", "agent-map.json");
  if (!(await exists(mapIndex)) && !(await exists(legacyMap))) {
    console.warn(
      "\n  ℹ  no routing map found (~/.invoker/map/ or ~/.invoker/agent-map.json).\n" +
      "     /promper will route from the in-session agent list when available.\n" +
      "     Run /promper:setup to build the lean map for reliable role inheritance."
    );
  }

  console.log("\n  Done. Restart Claude Code, then run /promper or /prim.\n");
}

main().catch((err) => {
  console.error(`\n  promper install failed: ${err.message}\n`);
  process.exit(1);
});
