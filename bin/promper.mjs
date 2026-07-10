#!/usr/bin/env node
// `npx promper` — copies the promper + prim skills into ~/.claude/skills/ and
// bootstraps the role source (the wshobson/agents marketplace — a HARD dependency).
// npx runs from a throwaway cache, so we COPY (not symlink, which the repo uses for local dev).
// `promper bootstrap` — ensure the wshobson/agents marketplace is added and scan it.
// `promper scan [--plugins <root>] [--no-defaults] [--dir <path>] [--check] [--out <path>]`
// `promper hydrate <agent> "<task>" [--json] [--template <path>] [--map <dir>]`
// `promper brief "<task>" [--agent <name>] [--subagent-type <type>] [--json] [--map <dir>] [--state <path>]`
// `promper gate "<prompt>" [--transcript <path>] [--prior-turns <n>] [--json]`

import { cp, mkdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SKILLS = ["promper", "promper-setup", "prim"];
const MARKETPLACE_REPO = "wshobson/agents";
const MARKETPLACE_NAME = "claude-code-workflows"; // its declared marketplace name
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(homedir(), ".claude", "skills");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// promper's role source is a hard dependency: add the marketplace if missing, then scan it.
async function bootstrap() {
  const cache = join(homedir(), ".claude", "plugins", "marketplaces", MARKETPLACE_NAME);

  if (!(await exists(cache))) {
    console.log(`  role source missing — adding marketplace ${MARKETPLACE_REPO}…`);
    const res = spawnSync("claude", ["plugin", "marketplace", "add", MARKETPLACE_REPO], {
      stdio: "inherit",
    });
    if (res.status !== 0 || !(await exists(cache))) {
      console.warn(
        "\n  ⚠  promper REQUIRES wshobson/agents as its role source and could not add it automatically" +
        (res.error ? ` (${res.error.message})` : "") + ".\n" +
        "     Run:  claude plugin marketplace add wshobson/agents\n" +
        "     Then: promper bootstrap\n"
      );
      return false;
    }
  }

  let mod;
  try {
    mod = await import("../dist/scan.js");
  } catch (err) {
    throw new Error(`could not load dist/scan.js (${err.message}); run \`npm run build\` first`);
  }
  await mod.runScan(["--plugins", cache, "--no-defaults"]);
  console.log(`\n  role source ready: ${cache}`);
  return true;
}

async function main() {
  await mkdir(dest, { recursive: true });

  for (const name of SKILLS) {
    const from = join(root, "skills", name);
    const to = join(dest, name);
    await cp(from, to, { recursive: true, force: true });
    console.log(`  installed  ${name}  →  ${to}`);
  }

  await bootstrap();

  console.log("\n  Done. Restart Claude Code, then run /promper or /prim.\n");
}

async function run() {
  const argv = process.argv.slice(2);
  if (argv[0] === "bootstrap") {
    const ok = await bootstrap();
    if (!ok) process.exit(1);
    return;
  }
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
  if (argv[0] === "brief") {
    let mod;
    try {
      mod = await import("../dist/brief.js");
    } catch (err) {
      throw new Error(`could not load dist/brief.js (${err.message}); run \`npm run build\` first`);
    }
    await mod.runBrief(argv.slice(1));
    return;
  }
  if (argv[0] === "gate") {
    let mod;
    try {
      mod = await import("../dist/gate.js");
    } catch (err) {
      throw new Error(`could not load dist/gate.js (${err.message}); run \`npm run build\` first`);
    }
    await mod.runGate(argv.slice(1));
    return;
  }
  await main();
}

run().catch((err) => {
  console.error(`\n  promper failed: ${err.message}\n`);
  process.exit(1);
});
