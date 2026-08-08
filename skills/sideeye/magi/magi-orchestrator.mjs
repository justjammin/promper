// Pure MAGI vote validator, tally, and report CLI.
//
//   node magi-orchestrator.mjs --votes votes.json [--out report.md]
//   node magi-orchestrator.mjs --selftest
//
// Live core spawning and bd-mail collection belong to Sideeye's host skill contract.

import Ajv from "ajv";
import {
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_ORDER = ["Melchior-1", "Balthasar-2", "Casper-3"];
const CORE_SET = new Set(CORE_ORDER);
const cores = JSON.parse(readFileSync(join(HERE, "cores.json"), "utf8")).cores;
const voteSchema = JSON.parse(
  readFileSync(join(HERE, "schemas", "vote.schema.json"), "utf8"),
);
const ajv = new Ajv({ allErrors: true, strict: false });
const validateVote = ajv.compile(voteSchema);

function validationMessage(index) {
  return (validateVote.errors ?? [])
    .map((error) => "vote[" + index + "]" + (error.instancePath || "/") + " " + error.message)
    .join("; ");
}

export function validateVotes(votes) {
  if (!Array.isArray(votes)) throw new Error("votes input must be a JSON array");
  if (votes.length !== 3) {
    throw new Error("MAGI requires exactly 3 votes, got " + votes.length);
  }
  votes.forEach((vote, index) => {
    if (!validateVote(vote)) throw new Error(validationMessage(index));
  });

  const names = votes.map((vote) => vote.core_name);
  const unique = new Set(names);
  if (unique.size !== names.length) {
    throw new Error("duplicate core vote or replayed message detected");
  }
  const missing = CORE_ORDER.filter((name) => !unique.has(name));
  const unknown = [...unique].filter((name) => !CORE_SET.has(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      "exact core set required; missing: " + (missing.join(", ") || "none") +
      "; unknown: " + (unknown.join(", ") || "none"),
    );
  }

  return CORE_ORDER.map((name) => votes.find((vote) => vote.core_name === name));
}

export function tally(votes) {
  const ordered = validateVotes(votes);
  const approve = ordered.filter((vote) => vote.vote === "APPROVE").length;
  const deny = ordered.length - approve;
  const majority = approve >= 2 ? "APPROVE" : "DENY";
  const dissent = ordered
    .filter((vote) => vote.vote !== majority)
    .map((vote) => vote.core_name);
  const consensus =
    approve === 3 ? "Unanimous approve" :
    approve === 2 ? "Split approve" :
    approve === 1 ? "Split deny" : "Unanimous deny";
  const verdict =
    approve === 3 ? "Approve" :
    approve === 2 ? "Approve with changes" :
    approve === 1 ? "Request changes" : "Reject approach";
  return { ordered, approve, deny, consensus, verdict, dissent };
}

export function renderReport(result) {
  const rows = result.ordered.map((vote) =>
    "| " + vote.core_name + " | " + vote.vote + " | " +
    vote.short_rationale_paragraph.replaceAll("|", "\\|") + " |",
  );
  return [
    "# MAGI Tribunal",
    "",
    "| Core | Vote | Rationale |",
    "|---|---|---|",
    ...rows,
    "",
    "**Consensus:** " + result.consensus + " → " + result.verdict,
    "**Dissent:** " + (result.dissent.join(", ") || "none"),
    "",
    "## Effective hyperparameter behavior",
    "",
    "Advisory. This validation/tally CLI does not spawn models or set sampling parameters. " +
      "A live host must record whether it honored each core's requested settings; otherwise " +
      "the personas carry the behavioral distinction.",
    "",
  ].join("\n");
}

function vote(coreName, decision) {
  return {
    core_name: coreName,
    short_rationale_paragraph: coreName + " resolves to " + decision + " in self-test.",
    vote: decision,
  };
}

function selftest() {
  const expected = {
    AAA: "Approve",
    AAD: "Approve with changes",
    ADA: "Approve with changes",
    DAA: "Approve with changes",
    ADD: "Request changes",
    DAD: "Request changes",
    DDA: "Request changes",
    DDD: "Reject approach",
  };
  let passed = 0;
  for (const [combination, expectedVerdict] of Object.entries(expected)) {
    const votes = CORE_ORDER.map((name, index) =>
      vote(name, combination[index] === "A" ? "APPROVE" : "DENY"),
    );
    const result = tally(votes);
    if (result.verdict !== expectedVerdict) {
      throw new Error(
        combination + " returned " + result.verdict + ", expected " + expectedVerdict,
      );
    }
    passed += 1;
  }
  console.log(
    "resolved: " + passed + "/8  exact cores: " +
    cores.map((core) => core.core_name).join(", ") + "  deadlocks: 0",
  );
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(name + " requires a value");
  return value;
}

function main(args) {
  if (args.includes("--selftest")) {
    selftest();
    return;
  }
  const votesPath = optionValue(args, "--votes");
  if (!votesPath) {
    throw new Error("usage: magi-orchestrator.mjs --votes votes.json [--out report.md]");
  }
  const votes = JSON.parse(readFileSync(votesPath, "utf8"));
  const result = tally(votes);
  const report = renderReport(result);
  const outputPath = optionValue(args, "--out");
  if (outputPath) writeFileSync(outputPath, report, "utf8");
  console.log(result.consensus + " → " + result.verdict);
  console.log("dissent: " + (result.dissent.join(", ") || "none"));
  console.log("hyperparameters: advisory unless the live host records support");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error("MAGI validation failed: " + error.message);
    process.exitCode = 1;
  }
}
