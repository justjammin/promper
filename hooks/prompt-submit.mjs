#!/usr/bin/env node
// promper UserPromptSubmit hook.
//
// Claude Code fires this on every prompt submission, handing us a JSON payload
// on stdin: { session_id, transcript_path, cwd, hook_event_name, prompt }.
//
// A UserPromptSubmit hook cannot literally rewrite the message that runs — it can
// only (a) add context, or (b) block. So "inject --run" means: emit additionalContext
// instructing Claude to take the submitted prompt and route it through promper's run
// flow (`/promper <intent> --run`), which decomposes via invokerai, inherits the
// proper agent's role, engineers the prompt, then spawns that agent and executes.
//
// We pass straight through (no context, exit 0) when routing would loop or isn't wanted:
//   - the prompt is already a slash-command (starts with "/")          → user is driving a skill
//   - the prompt is empty / whitespace
//   - the prompt carries the opt-out marker "--raw" (stripped on output)
//
// Configure with bin/setup-runner.mjs, which also strips any invokerai prompt-submit
// hook so promper takes over routing.

const OPT_OUT = "--raw";

function read(stream) {
  return new Promise((resolve, reject) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => (buf += c));
    stream.on("end", () => resolve(buf));
    stream.on("error", reject);
  });
}

// Pass through silently: exit 0 with no stdout means "leave the prompt untouched".
function passthrough() {
  process.exit(0);
}

function inject(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context,
      },
    })
  );
  process.exit(0);
}

async function main() {
  let payload = {};
  try {
    const raw = await read(process.stdin);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    // Malformed payload — never block the user, just pass through.
    passthrough();
    return;
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const trimmed = prompt.trim();

  // Nothing to route, or the user is already invoking a skill/command.
  if (!trimmed || trimmed.startsWith("/")) passthrough();

  // Explicit opt-out: honor a one-off raw prompt.
  if (trimmed.includes(OPT_OUT)) passthrough();

  // Build the routing instruction. We keep the user's original intent verbatim so
  // promper engineers from exactly what they typed.
  const intent = trimmed;

  inject(
    [
      "Routing directive from the promper prompt-submit hook (`promper run` mode is active):",
      "",
      "Treat the user's message above as a raw INTENT to be engineered and executed, not as a",
      "question to answer directly. Run the promper skill in run mode on it:",
      "",
      "  /promper " + intent + " --run",
      "",
      "Concretely: route the intent through invokerai (decompose + spawn-selection) to discover",
      "the proper agent, inherit that agent's persona as the <role>, engineer the rest of the",
      "prompt (context, instructions, examples, constraints, output_format), then spawn the",
      "selected agent(s) with that engineered brief and execute — returning the result of the run,",
      "not just the prompt. This mirrors a `/promper ... --run` invocation; the `--run` flag is",
      "injected by the hook. If the message is itself a request to *engineer a prompt* rather than",
      "to act, fall back to promper's normal intent guard.",
      "",
      "To bypass this routing for a single message, append `" + OPT_OUT + "` to the prompt.",
    ].join("\n")
  );
}

main().catch(() => passthrough());
