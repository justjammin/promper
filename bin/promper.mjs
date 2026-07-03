#!/usr/bin/env node
// `npx promper` — copies the promper + prim skills into ~/.claude/skills/.
// npx runs from a throwaway cache, so we COPY (not symlink, which the repo uses for local dev).
// `promper scan [--dir <path>] [--check] [--legacy] [--out <path>]` — build the
// lean routing map at ~/.invoker/map/ deterministically (see dist/scan.js).

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

async function run() {
  const argv = process.argv.slice(2);
  if (argv[0] === "scan") {
    let mod;
    try {
      mod = await import("../dist/scan.js");
    } catch (err) {
      throw new Error(`could not load dist/scan.js (${err.message}); run \`npm run build\` first`);
    }
    await mod.runScan(argv.slice(1));
    return;
  }
  if (argv[0] === "hydrate") {
    let mod;
    try {
      mod = await import("../dist/hydrate.js");
    } catch (err) {
      throw new Error(`could not load dist/hydrate.js (${err.message}); run \`npm run build\` first`);
    }
    await mod.runHydrate(argv.slice(1));
    return;
  }
  await main();
}

run().catch((err) => {
  console.error(`\n  promper failed: ${err.message}\n`);
  process.exit(1);
});
