// Shared promper-routing logic used by every source pass.
//
// A "route" turns a bare user prompt into a promper `--run` directive. Two framings:
//   - contextDirective(intent): ADDITIVE — for tools whose prompt hook can only add context
//     (Claude Code). The original prompt stays; this is appended as guidance.
//   - rewritePrompt(intent): REPLACEMENT — for tools whose prompt mechanism takes the rewritten
//     prompt directly (.codex/.cursor/etc). The original prompt is replaced by this.
//
// Both honor the same skip rules so routing never loops or fights an explicit opt-out.

export const OPT_OUT = "--raw";

// Pull the user's prompt out of whatever payload shape a tool hands us.
export function normalizePrompt(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  for (const k of ["prompt", "user_prompt", "userPrompt", "input", "message", "text"]) {
    if (typeof payload[k] === "string") return payload[k];
  }
  return "";
}

// Route a prompt unless it would loop or the user opted out.
export function shouldRoute(prompt) {
  const t = (prompt || "").trim();
  if (!t) return false; // nothing to route
  if (t.startsWith("/")) return false; // already a slash-command / skill invocation
  if (t.includes(OPT_OUT)) return false; // explicit one-off bypass
  return true;
}

// ADDITIVE context (Claude): the skill exists, so point at it directly.
export function contextDirective(intent) {
  return [
    "Routing directive from the promper prompt-submit hook (`promper run` mode is active):",
    "",
    "Treat the user's message above as a raw INTENT to be engineered and executed, not as a",
    "question to answer directly. Run the promper skill in run mode on it:",
    "",
    "  /promper " + intent + " --run",
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

// REPLACEMENT prompt (non-Claude): self-contained, since the promper skill may not be installed.
export function rewritePrompt(intent) {
  return [
    "# Engineered via promper (run mode)",
    "",
    "Infer the single most fitting expert role for the intent below and adopt it. Engineer the request",
    "internally — clear task, the context a competent stranger would need, constraints, and an explicit",
    "output format — then carry it out end-to-end and return the RESULT, not a prompt. If information is",
    "missing, say so rather than inventing it.",
    "",
    "(promper --run; the run is injected by the hook. Append `" + OPT_OUT + "` to a prompt to bypass.)",
    "",
    "## Intent",
    intent,
  ].join("\n");
}
