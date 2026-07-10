/**
 * gate.ts — `promper gate "<prompt>" [--transcript <path>] [--prior-turns <n>] [--json]`
 *
 * Deterministic follow-up-vs-deep-dive classifier for the UserPromptSubmit hook. No LLM, no
 * ML. The session opener (no prior user turns) is always "deep". Later turns default to
 * "follow-up" — only a strong new-task signal (no back-reference, reasonable length) flips it
 * to "deep". Biased toward under-triggering: never nag on an ordinary follow-up.
 */

import { promises as fs } from "node:fs";

export type GateVerdict = "deep" | "follow-up";

const BACK_REFERENCE =
  /^(also|now|and|then|ok(ay)?|sure|yes|no|yeah|yep|nah|it|that|this|the same|same thing|continue|keep going|go ahead|do (it|that)|what about|how about|one more|another)\b/i;
const MIN_DEEP_WORDS = 4;

export function classifyGate(priorUserTurns: number, prompt: string): GateVerdict {
  if (priorUserTurns <= 0) return "deep"; // session opener — always worth routing
  const trimmed = prompt.trim();
  if (!trimmed) return "follow-up";
  if (BACK_REFERENCE.test(trimmed)) return "follow-up";
  if (trimmed.split(/\s+/).length < MIN_DEEP_WORDS) return "follow-up";
  return "deep";
}

function isUserTurn(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const rec = obj as Record<string, unknown>;
  const message = rec["message"];
  const nestedRole =
    typeof message === "object" && message !== null && typeof (message as Record<string, unknown>)["role"] === "string"
      ? ((message as Record<string, unknown>)["role"] as string)
      : "";
  const role = (typeof rec["type"] === "string" && rec["type"]) || (typeof rec["role"] === "string" && rec["role"]) || nestedRole;
  return role === "user";
}

/** Count prior user turns in a Claude Code JSONL transcript (one JSON object per line). */
export async function countPriorUserTurns(transcriptPath: string | null): Promise<number> {
  if (!transcriptPath) return 0;
  let raw: string;
  try {
    raw = await fs.readFile(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isUserTurn(obj)) count++;
  }
  return count;
}

interface GateOptions {
  prompt: string;
  transcriptPath: string | null;
  priorTurns: number | null;
  json: boolean;
}

function parseArgs(argv: string[]): GateOptions {
  const positional: string[] = [];
  const opts: GateOptions = { prompt: "", transcriptPath: null, priorTurns: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--transcript": {
        const value = argv[++i];
        if (!value) throw new Error("--transcript requires a path");
        opts.transcriptPath = value;
        break;
      }
      case "--prior-turns": {
        const value = argv[++i];
        if (!value) throw new Error("--prior-turns requires a number");
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error("--prior-turns must be a number");
        opts.priorTurns = n;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
        positional.push(arg);
    }
  }
  opts.prompt = positional.join(" ");
  return opts;
}

export async function runGate(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const priorTurns = opts.priorTurns ?? (await countPriorUserTurns(opts.transcriptPath));
  const verdict = classifyGate(priorTurns, opts.prompt);
  if (opts.json) {
    console.log(JSON.stringify({ verdict, priorTurns }, null, 2));
    return;
  }
  console.log(verdict);
}
