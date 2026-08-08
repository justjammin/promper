import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), "utf8");
}

test("Orbit suite has self-contained packaged skill assets", async () => {
  const required = [
    "skills/orbit/SKILL.md",
    "skills/orbit/DESIGN.md",
    "skills/orbit/breakdown-interview.md",
    "skills/orbit/viz/orbit-tracker.html",
    "skills/orbit/viz/status.schema.json",
    "skills/genesis/SKILL.md",
    "skills/horizon/SKILL.md",
    "skills/horizon/server/horizon-server.mjs",
    "skills/horizon/schemas/plan.schema.json",
    "skills/horizon/schemas/feedback.schema.json",
    "skills/horizon/template/index.html",
    "skills/horizon/template/render.js",
    "skills/sideeye/SKILL.md",
    "skills/sideeye/magi/magi-orchestrator.mjs",
    "skills/sideeye/magi/schemas/vote.schema.json",
    "skills/sideeye/references/judge-protocol.md",
  ];
  await Promise.all(required.map((path) => access(join(ROOT, path))));
});

test("installer and docs expose all Orbit-family skills", async () => {
  const [bin, readme] = await Promise.all([read("bin/promper.mjs"), read("README.md")]);
  for (const skill of ["orbit", "genesis", "horizon", "sideeye"]) {
    assert.match(bin, new RegExp(`const SKILLS = \\[[^\\]]*"${skill}"`, "s"));
    assert.match(readme, new RegExp(`/promper:${skill}|/${skill}`));
  }
});

test("Sideeye code-review branch fails closed and separates review axes", async () => {
  const source = await read("skills/sideeye/SKILL.md");
  for (const term of [
    "code-review branch",
    "fixed point",
    "scoped diff",
    "fail before dispatch",
    "## Standards",
    "## Spec",
    "per-axis",
  ]) {
    assert.ok(source.includes(term), `missing Sideeye review contract: ${term}`);
  }
});

test("review fixture keeps standards-only and spec-only defects independent", async () => {
  const fixture = JSON.parse(await read("test/fixtures/orbit-suite/review/separated.valid.json"));
  const standards = new Set(fixture.expected.standards);
  const spec = new Set(fixture.expected.spec);
  assert.equal(fixture.defects.length, 2);
  assert.deepEqual([...standards].filter((id) => spec.has(id)), []);
  assert.equal(fixture.defects.find((defect) => defect.id === [...standards][0]).kind, "documented-standard");
  assert.equal(fixture.defects.find((defect) => defect.id === [...spec][0]).kind, "missing-requirement");
});

test("Orbit documents state-only observer emissions and non-blocking failure", async () => {
  const source = await read("skills/orbit/SKILL.md");
  for (const term of [
    "optional observer",
    "phase transition",
    "blocked",
    "MAGI initialization",
    "per-core",
    "consensus",
    "terminal",
    "non-blocking observer warning",
  ]) {
    assert.ok(source.includes(term), `missing tracker contract: ${term}`);
  }
  assert.match(source, /never[^\n]+vote[^\n]+rationale/i);
});

test("Breakdown consumes validated Orbit plans through a delta interview", async () => {
  const source = await read("skills/breakdown/SKILL.md");
  for (const term of [
    "delta interview",
    "plan.json",
    "horizon/feedback.json",
    "derived-from: plan.json@<hash>",
    "patterns.selected",
    "patterns.rejected",
  ]) {
    assert.ok(source.includes(term), `missing Breakdown delta contract: ${term}`);
  }
});

test("Orbit suite ships one JavaScript runtime source per component", async () => {
  for (const path of [
    "skills/horizon/server/horizon-server.ts",
    "skills/sideeye/magi/magi-orchestrator.ts",
  ]) {
    await assert.rejects(access(join(ROOT, path)), `handwritten mirror must be absent: ${path}`);
  }
});
