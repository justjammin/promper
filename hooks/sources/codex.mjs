// Codex pass (.codex/) — DIRECT REWRITE.
// Codex consumes a prompt, so we replace the bare intent with the engineered run directive.
// When routing is skipped, echo the original prompt unchanged so nothing is lost.

import { shouldRoute, rewritePrompt } from "../lib/route.mjs";

export const name = "codex";

export function handle({ prompt }) {
  const intent = (prompt || "").trim();
  if (!shouldRoute(prompt)) return { mode: "rewrite", prompt };
  return { mode: "rewrite", prompt: rewritePrompt(intent) };
}
