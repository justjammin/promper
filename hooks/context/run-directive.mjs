// Context contributor: the core promper run directive.
//
// This is the additive context for Claude — it steers the turn into the `/promper … --run` flow
// without rewriting the prompt (a UserPromptSubmit hook can only add context). It used to live
// inline in the hook; it's now a drop-in contributor so context is composed, not hardcoded.

import { OPT_OUT } from "../lib/route.mjs";

export const order = 10; // the primary directive — keep it first

export function contribute({ intent }) {
  const it = (intent || "").trim();
  if (!it) return null;
  return [
    "Routing directive from the promper prompt-submit hook (`promper run` mode is active):",
    "",
    "Treat the user's message above as a raw INTENT to be engineered and executed, not as a",
    "question to answer directly. Run the promper skill in run mode on it:",
    "",
    "  /promper " + it + " --run",
    "",
    "Route the intent through invokerai (decompose + spawn-selection) to discover the proper agent,",
    "inherit that agent's persona as the <role>, engineer the rest of the prompt, then spawn the",
    "selected agent(s) and execute — returning the result of the run, not just the prompt. The `--run`",
    "flag is injected by the hook. If the message is itself a request to *engineer a prompt* rather",
    "than to act, fall back to promper's normal intent guard.",
    "",
    "To bypass this routing for a single message, append `" + OPT_OUT + "` to the prompt.",
  ].join("\n");
}
