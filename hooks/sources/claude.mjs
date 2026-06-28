// Claude Code pass — ADDITIVE.
// A UserPromptSubmit hook can only add context or block; it cannot rewrite the prompt.
// So we emit additionalContext steering the turn into the `/promper … --run` flow.

import { shouldRoute, contextDirective } from "../lib/route.mjs";

export const name = "claude";

export function handle({ prompt }) {
  if (!shouldRoute(prompt)) return { mode: "noop" };
  return { mode: "context", text: contextDirective(prompt.trim()) };
}
