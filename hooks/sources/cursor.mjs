// Cursor pass (.cursor/) — DIRECT REWRITE.
// Cursor takes a prompt, so we replace the bare intent with the engineered run directive.
// When routing is skipped, echo the original prompt unchanged.

import { shouldRoute, rewritePrompt } from "../lib/route.mjs";

export const name = "cursor";

export function handle({ prompt }) {
  const intent = (prompt || "").trim();
  if (!shouldRoute(prompt)) return { mode: "rewrite", prompt };
  return { mode: "rewrite", prompt: rewritePrompt(intent) };
}
