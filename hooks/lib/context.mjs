// Context builder — assembles the additionalContext for additive tools (Claude) from drop-in
// contributors under hooks/context/, instead of the hook carrying one hardcoded string.
//
// Each contributor is a .mjs file in hooks/context/ exporting:
//   contribute(ctx) -> string | null | undefined | Promise<...>   (the text to add, or nothing)
//   order?: number                                                (sort key, default 100; lower first)
//
// ctx = { intent, prompt, payload, cwd, source }. Add context by dropping in a file — same pattern
// as sources/. buildContext() runs every contributor, drops empties, and joins with blank lines.
// A contributor that throws or returns nothing is skipped; it can never break the hook.

import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONTEXT_DIR = join(here, "..", "context");

async function loadContributors() {
  let files;
  try {
    files = await readdir(CONTEXT_DIR);
  } catch {
    return []; // no context/ dir → no contributors
  }
  const mods = [];
  for (const file of files) {
    if (!file.endsWith(".mjs")) continue;
    try {
      const mod = await import(join(CONTEXT_DIR, file));
      if (typeof mod.contribute === "function") {
        mods.push({ file, order: typeof mod.order === "number" ? mod.order : 100, contribute: mod.contribute });
      }
    } catch {
      // A broken contributor file is skipped, not fatal.
    }
  }
  mods.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
  return mods;
}

// Returns the joined context string, or null if no contributor produced anything.
export async function buildContext(ctx) {
  const mods = await loadContributors();
  const parts = [];
  for (const m of mods) {
    let out;
    try {
      out = await m.contribute(ctx);
    } catch {
      continue; // one contributor failing must not drop the rest
    }
    if (typeof out === "string" && out.trim()) parts.push(out.trim());
  }
  return parts.length ? parts.join("\n\n") : null;
}
