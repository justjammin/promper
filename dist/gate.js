// src/gate.ts
import { promises as fs } from "node:fs";
var BACK_REFERENCE = /^(also|now|and|then|ok(ay)?|sure|yes|no|yeah|yep|nah|it|that|this|the same|same thing|continue|keep going|go ahead|do (it|that)|what about|how about|one more|another)\b/i;
var MIN_DEEP_WORDS = 4;
function classifyGate(priorUserTurns, prompt) {
  if (priorUserTurns <= 0) return "deep";
  const trimmed = prompt.trim();
  if (!trimmed) return "follow-up";
  if (BACK_REFERENCE.test(trimmed)) return "follow-up";
  if (trimmed.split(/\s+/).length < MIN_DEEP_WORDS) return "follow-up";
  return "deep";
}
function isUserTurn(obj) {
  if (typeof obj !== "object" || obj === null) return false;
  const rec = obj;
  const message = rec["message"];
  const nestedRole = typeof message === "object" && message !== null && typeof message["role"] === "string" ? message["role"] : "";
  const role = typeof rec["type"] === "string" && rec["type"] || typeof rec["role"] === "string" && rec["role"] || nestedRole;
  return role === "user";
}
async function countPriorUserTurns(transcriptPath) {
  if (!transcriptPath) return 0;
  let raw;
  try {
    raw = await fs.readFile(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isUserTurn(obj)) count++;
  }
  return count;
}
function parseArgs(argv) {
  const positional = [];
  const opts = { prompt: "", transcriptPath: null, priorTurns: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === void 0) continue;
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
async function runGate(argv) {
  const opts = parseArgs(argv);
  const priorTurns = opts.priorTurns ?? await countPriorUserTurns(opts.transcriptPath);
  const verdict = classifyGate(priorTurns, opts.prompt);
  if (opts.json) {
    console.log(JSON.stringify({ verdict, priorTurns }, null, 2));
    return;
  }
  console.log(verdict);
}
export {
  classifyGate,
  countPriorUserTurns,
  runGate
};
