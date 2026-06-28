// Default pass — DIRECT REWRITE.
// Used for any source that isn't Claude and isn't a recognized tool dir. Safest assumption for
// an unknown tool is that it consumes a prompt, so we rewrite (and echo unchanged when skipped).

import { shouldRoute, rewritePrompt } from "../lib/route.mjs";

export const name = "default";

export function handle({ prompt }) {
  const intent = (prompt || "").trim();
  if (!shouldRoute(prompt)) return { mode: "rewrite", prompt };
  return { mode: "rewrite", prompt: rewritePrompt(intent) };
}
