#!/usr/bin/env node
// `npm run build:manifests` [-- --check]
//
// Generates .claude-plugin/plugin.json and .codex-plugin/plugin.json from ONE canonical
// source (plugin.source.json + package.json's version), so the two manifests never drift.
// Modeled on the wshobson/agents tools/adapters pattern: one plugin definition, per-tool
// output shapes. `--check` does a dry run (CI-friendly) and exits 1 if either file is stale.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function serialize(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Write only when content differs. Returns true when the file changed (or would change). */
async function writeIfChanged(path, content, check) {
  let current = null;
  try {
    current = await fs.readFile(path, "utf8");
  } catch {
    /* file doesn't exist yet */
  }
  if (current === content) return false;
  if (!check) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, "utf8");
  }
  return true;
}

function buildClaudeManifest(source, version) {
  const manifest = {
    name: source.name,
    version,
    description: source.description,
  };
  if (source.skills) manifest.skills = source.skills;
  if (source.hooks) manifest.hooks = source.hooks;
  manifest.author = source.author;
  if (source.homepage) manifest.homepage = source.homepage;
  if (source.repository) manifest.repository = source.repository;
  manifest.license = source.license;
  if (source.keywords) manifest.keywords = source.keywords;
  return manifest;
}

function buildCodexManifest(source, version) {
  // Deliberately minimal — matches the wshobson/agents convention: no homepage/repository/
  // keywords in the codex manifest, just what the codex marketplace listing needs.
  const manifest = {
    name: source.name,
    version,
    description: source.description,
  };
  if (source.skills) manifest.skills = source.skills;
  if (source.hooks) manifest.hooks = source.hooks;
  manifest.author = source.author;
  manifest.license = source.license;
  manifest.interface = {
    displayName: source.codex.displayName,
    shortDescription: source.codex.shortDescription,
    category: source.codex.category,
  };
  return manifest;
}

async function main() {
  const check = process.argv.includes("--check");

  const source = await readJson(join(ROOT, "plugin.source.json"));
  const pkg = await readJson(join(ROOT, "package.json"));

  const claudePath = join(ROOT, ".claude-plugin", "plugin.json");
  const codexPath = join(ROOT, ".codex-plugin", "plugin.json");

  const claudeChanged = await writeIfChanged(claudePath, serialize(buildClaudeManifest(source, pkg.version)), check);
  const codexChanged = await writeIfChanged(codexPath, serialize(buildCodexManifest(source, pkg.version)), check);

  const changed = [claudeChanged && ".claude-plugin/plugin.json", codexChanged && ".codex-plugin/plugin.json"].filter(
    Boolean,
  );

  if (check) {
    if (changed.length > 0) {
      console.error(`[check] stale: ${changed.join(", ")} — run \`npm run build:manifests\``);
      process.exit(1);
    }
    console.log("[check] manifests up to date");
    return;
  }

  console.log(changed.length > 0 ? `wrote: ${changed.join(", ")}` : "no changes (manifests up to date)");
}

main().catch((err) => {
  console.error(`gen-manifests failed: ${err.message}`);
  process.exit(1);
});
