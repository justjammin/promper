// Shared promper-routing logic used by every source pass.
//
// This module owns the skip rules and the REPLACEMENT framing (rewritePrompt) used by direct-rewrite
// tools. The ADDITIVE framing — the context appended for Claude — is not here: it's assembled by
// lib/context.mjs from drop-in contributors under hooks/context/, so "adding context" is its own
// pluggable concern rather than a string baked into the hook. See hooks/context/run-directive.mjs.

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
