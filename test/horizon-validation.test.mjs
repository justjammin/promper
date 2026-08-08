import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(ROOT, relativePath), "utf8"));
}

test("Horizon validators enforce schemas and semantic approval gates", async () => {
  const { createHorizonValidators } = await import("../skills/horizon/server/validation.mjs");
  const validators = await createHorizonValidators(join(ROOT, "skills", "horizon"));
  const plan = await readJson("test/fixtures/orbit-suite/plan/full.valid.json");

  assert.equal(validators.plan(plan).ok, true);
  assert.equal(validators.plan({ ...plan, injected: true }).ok, false);
  assert.equal(validators.status({
    run: { slug: "x", engine: "breakdown", tribunal: "solo" },
    phases: [{ id: "genesis", label: "<img onerror=alert(1)>", status: "active" }],
    magi: { active: false, state: "idle", cores: [] },
    vote: "APPROVE",
  }).ok, false);

  const approvals = Object.fromEntries(
    ["positioning", "evidence", "domainModel", "patterns", "risks", "openQuestions", "scope"]
      .map((key) => [key, "approve"]),
  );
  const approved = {
    slug: plan.meta.slug,
    verdict: "approved",
    decisions: [{ ref: "q1", answer: "100 req/min" }],
    approvals,
    notes: "",
  };

  assert.equal(validators.feedback(approved, plan).ok, true);
  assert.equal(validators.feedback({ ...approved, slug: "wrong" }, plan).ok, false);
  assert.equal(validators.feedback({ ...approved, decisions: [{ ref: "q1", answer: " " }] }, plan).ok, false);
  assert.equal(validators.feedback({ ...approved, approvals: { ...approvals, risks: "change" } }, plan).ok, false);
  assert.equal(validators.feedback({ ...approved, verdict: "changes-requested" }, plan).ok, false);
});

test("Horizon and tracker render untrusted labels through text nodes", async () => {
  const [renderer, tracker] = await Promise.all([
    readFile(join(ROOT, "skills/horizon/template/render.js"), "utf8"),
    readFile(join(ROOT, "skills/orbit/viz/orbit-tracker.html"), "utf8"),
  ]);
  assert.doesNotMatch(renderer, /innerHTML\s*=\s*`/);
  assert.doesNotMatch(tracker, /innerHTML\s*=\s*status\./);
  assert.doesNotMatch(tracker, /status\.phases\.map[\s\S]{0,300}innerHTML/);
});

test("Orbit observer lifecycle stays schema-valid and state-only", async () => {
  const { createHorizonValidators } = await import("../skills/horizon/server/validation.mjs");
  const validators = await createHorizonValidators(join(ROOT, "skills", "horizon"));
  const events = await readJson("test/fixtures/orbit-suite/status/lifecycle.valid.json");
  const banned = /^(intent|prd|plan|vote|verdict|rationale|evidence|decision)$/i;

  function assertStateOnly(value) {
    if (Array.isArray(value)) return value.forEach(assertStateOnly);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, banned);
      assertStateOnly(child);
    }
  }

  assert.equal(events.length >= 5, true);
  for (const event of events) {
    assert.equal(validators.status(event).ok, true);
    assertStateOnly(event);
  }
  assert.equal(events.some((event) => event.phases.some((phase) => phase.status === "blocked")), true);
  assert.equal(events.some((event) => event.magi.active && event.magi.state === "deciding"), true);
  assert.equal(events.some((event) => event.magi.cores.some((core) => core.state === "decided")), true);
  assert.equal(events.some((event) => event.magi.consensusReached), true);
  assert.equal(events.at(-1).phases.every((phase) => phase.status === "done"), true);
});
