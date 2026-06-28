// Claude Code pass — ADDITIVE.
// A UserPromptSubmit hook can only add context or block; it cannot rewrite the prompt. So we ask
// the context builder (lib/context.mjs) for the additionalContext, assembled from the contributors
// under hooks/context/ — the hook doesn't carry the text itself.

import { shouldRoute } from "../lib/route.mjs";
import { buildContext } from "../lib/context.mjs";

export const name = "claude";

export async function handle(ctx) {
  if (!shouldRoute(ctx.prompt)) return { mode: "noop" };
  const text = await buildContext({ ...ctx, intent: ctx.prompt.trim() });
  if (!text) return { mode: "noop" }; // no contributor produced context → pass through
  return { mode: "context", text };
}
