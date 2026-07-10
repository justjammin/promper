#!/usr/bin/env node
// Bundles each CLI entry point (scan/hydrate/brief/gate) into a single, dependency-free
// dist/<name>.js — no node_modules lookup needed at runtime.
//
// Why this exists: promper ships as a Claude Code plugin. A marketplace install is a raw git
// checkout — Claude Code never runs `npm install` for it — so a plain `tsc` compile that just
// re-emits `import "js-yaml"` resolves fine in this dev checkout (which has node_modules) but
// silently fails to load on a real install. The PreToolUse hook's own error handling then
// swallows that failure (by design, so a broken hook never blocks a real tool call), which
// made the entire spawn-brief rewrite quietly dead in production. Bundling every dependency in
// removes the failure mode at the source instead of working around it.

import { build } from "esbuild";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["scan", "hydrate", "brief", "gate"];

async function main() {
  const distDir = join(ROOT, "dist");
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  for (const name of ENTRIES) {
    await build({
      entryPoints: [join(ROOT, "src", `${name}.ts`)],
      outfile: join(distDir, `${name}.js`),
      bundle: true,
      platform: "node",
      target: "node18",
      format: "esm",
      packages: "bundle", // inline every dependency (js-yaml) — zero runtime node_modules lookups
      sourcemap: false,
      logLevel: "warning",
    });
    console.log(`  bundled  ${name}.ts  →  dist/${name}.js`);
  }
}

main().catch((err) => {
  console.error(`build-dist failed: ${err.message}`);
  process.exit(1);
});
