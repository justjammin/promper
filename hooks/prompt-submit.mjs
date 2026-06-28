#!/usr/bin/env node
// promper prompt-submit hook — a DISPATCHER.
//
// One entry point, many passes. It reads the submitted prompt from stdin, detects which AI tool
// the prompt came from, and routes to that tool's pass:
//
//   Claude Code         → ADDITIVE context  (a UserPromptSubmit hook can only add context)
//   .codex / .cursor /… → DIRECT REWRITE    (those mechanisms take the rewritten prompt itself)
//   unknown             → default (rewrite)
//
// Each pass turns a bare prompt into a promper `--run` directive, but in the shape its tool expects
// — "command outputs of the same nature" as the source it came from. Passes live in sources/;
// shared promper logic lives in lib/route.mjs. Add a tool by dropping in sources/<name>.mjs and a
// detection marker below.
//
// Detection priority: PROMPER_SOURCE env → Claude hook signature → tool config dir in cwd → default.

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Directory marker → source name. First match wins.
const DIR_MARKERS = [
  ["cursor", ".cursor"],
  ["codex", ".codex"],
  ["windsurf", ".windsurf"],
  ["claude", ".claude"],
];

// Sources that have a dedicated pass file. Anything else falls back to default.mjs.
const KNOWN = new Set(["claude", "codex", "cursor", "default"]);

function read(stream) {
  return new Promise((resolve) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => (buf += c));
    stream.on("end", () => resolve(buf));
    stream.on("error", () => resolve(""));
  });
}

function parsePayload(raw) {
  const text = (raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text); // structured tools (Claude, etc.)
  } catch {
    return { prompt: raw }; // raw-text stdin → treat the whole thing as the prompt
  }
}

function detectSource(payload, cwd) {
  const env = (process.env.PROMPER_SOURCE || "").trim().toLowerCase();
  if (env) return env;
  // Claude Code's UserPromptSubmit payload carries this signature.
  if (payload && payload.hook_event_name === "UserPromptSubmit") return "claude";
  for (const [src, dir] of DIR_MARKERS) {
    if (existsSync(join(cwd, dir))) return src;
  }
  return "default";
}

async function loadPass(source) {
  const name = KNOWN.has(source) ? source : "default";
  try {
    return await import(join(here, "sources", `${name}.mjs`));
  } catch {
    return await import(join(here, "sources", "default.mjs"));
  }
}

// normalizePrompt lives in lib/route.mjs; import lazily so a broken pass can't block stdin read.
async function getPrompt(payload) {
  const { normalizePrompt } = await import(join(here, "lib", "route.mjs"));
  return normalizePrompt(payload);
}

function emit(result, originalPrompt) {
  switch (result?.mode) {
    case "context":
      // Claude additive: exit 0 with hookSpecificOutput.additionalContext.
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: result.text,
          },
        })
      );
      return;
    case "rewrite":
      // Direct-rewrite tools: stdout IS the (possibly unchanged) prompt.
      process.stdout.write(result.prompt ?? originalPrompt ?? "");
      return;
    case "noop":
    default:
      // Pass the prompt through untouched.
      return;
  }
}

async function main() {
  const payload = parsePayload(await read(process.stdin));
  const cwd = (payload && typeof payload.cwd === "string" && payload.cwd) || process.cwd();
  const source = detectSource(payload, cwd);

  const prompt = await getPrompt(payload);
  const pass = await loadPass(source);

  const result = await pass.handle({ prompt, payload, cwd, source });
  emit(result, prompt);
}

main().catch(() => {
  // Never block a submission on a hook failure.
  process.exit(0);
});
