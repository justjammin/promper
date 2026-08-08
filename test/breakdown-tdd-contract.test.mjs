import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyText } from "../dist/classify.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINEERING_DOMAINS = new Set(["backend", "database", "data", "ml", "devops", "architecture"]);

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), "utf8");
}

test("representative engineering actions classify into deterministic TDD domains", async () => {
  const cases = [
    ["design payment ledger API", "backend"],
    ["add postgres migration", "database"],
    ["build ETL data pipeline", "data"],
  ];

  for (const [action, expectedDomain] of cases) {
    const result = await classifyText(action, join(ROOT, "test", "fixtures", "missing-map"), null);
    assert.equal(result.primary, expectedDomain, `${action} should classify as ${expectedDomain}`);
  }
});

test("Breakdown documents the deterministic TDD package contract", async () => {
  const source = await read("skills/breakdown/SKILL.md");
  const required = [
    "Phase 4b — TDD tier assignment",
    "`backend`, `database`, `data`, `ml`, `devops`, `architecture`",
    "`test_tier: null`",
    "red-green-refactor",
    "`write_first`",
    "`gated_followup`",
    "`post_ship`",
    "\"followup_tests\"",
  ];

  for (const term of required) {
    assert.ok(source.includes(term), `missing Breakdown TDD contract term: ${term}`);
  }
});

test("shipped Promper skills use supported Beads create flags", async () => {
  const sources = await Promise.all([
    read("skills/promper/SKILL.md"),
    read("skills/breakdown/SKILL.md"),
  ]);
  const commands = sources.flatMap((source) => source.split("\n").filter((line) => line.includes("bd create")));

  assert.ok(commands.length > 0, "expected documented bd create commands");
  for (const command of commands) {
    assert.doesNotMatch(command, /(?:^|\s)--epic(?:\s|$)/, `unsupported --epic flag: ${command}`);
    assert.doesNotMatch(command, /(?:^|\s)--depends(?:\s|$)/, `unsupported --depends flag: ${command}`);
  }
  assert.match(sources[1], /bd create[^\n]+--type epic/);
  assert.match(sources[1], /bd create[^\n]+--deps/);
});

test("package fixture assigns tiers and one engineering-wide follow-up", async () => {
  const fixture = JSON.parse(await read("test/fixtures/breakdown-tdd-package.json"));
  const engineeringNodes = fixture.nodes.filter((node) => ENGINEERING_DOMAINS.has(node.domain));
  const nonEngineeringNodes = fixture.nodes.filter((node) => !ENGINEERING_DOMAINS.has(node.domain));

  assert.ok(engineeringNodes.length > 0);
  for (const node of engineeringNodes) {
    assert.ok(node.test_tier, `${node.id} should have a test tier`);
    assert.ok(node.test_tier.write_first.includes("integration"));
    assert.deepEqual(node.test_tier.post_ship, ["smoke", "regression"]);
  }
  for (const node of nonEngineeringNodes) assert.equal(node.test_tier, null);

  const followups = fixture.bead_commands.filter((command) => command.kind === "followup_tests");
  assert.equal(followups.length, 1, "generate exactly one post-ship follow-up bead");
  assert.equal(fixture.beads.followup_tests, followups[0].id);

  const expectedDependencies = engineeringNodes.map((node) => fixture.beads.nodes[node.id]).sort();
  assert.deepEqual([...followups[0].deps].sort(), expectedDependencies);
});
