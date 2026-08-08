import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "skills", "horizon", "server", "horizon-server.mjs");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function startServer(planPath, outputPath) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, planPath, outputPath, "--port=" + port], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  const deadline = Date.now() + 8_000;
  while (!log.includes("horizon:")) {
    if (child.exitCode !== null) throw new Error("Horizon exited early: " + log);
    if (Date.now() > deadline) throw new Error("Timed out starting Horizon: " + log);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return {
    base: "http://127.0.0.1:" + port,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

async function post(base, path, body) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Horizon rejects invalid boundary payloads without mutating state or files", async (context) => {
  const temp = await mkdtemp(join(tmpdir(), "promper-horizon-api-"));
  const planPath = join(ROOT, "test", "fixtures", "orbit-suite", "plan", "full.valid.json");
  const outputPath = join(temp, "feedback.json");
  const server = await startServer(planPath, outputPath);
  context.after(server.stop);

  const originalPlan = await fetch(server.base + "/api/plan").then((response) => response.json());
  const originalStatus = await fetch(server.base + "/api/status").then((response) => response.json());
  const snapshotBefore = await readFile(join(temp, "plan.snapshot.json"), "utf8");

  const invalidPlan = await post(server.base, "/api/plan", {});
  assert.equal(invalidPlan.status, 400);
  assert.equal((await invalidPlan.json()).error.code, "invalid_plan");
  assert.deepEqual(await fetch(server.base + "/api/plan").then((response) => response.json()), originalPlan);
  assert.equal(await readFile(join(temp, "plan.snapshot.json"), "utf8"), snapshotBefore);

  const invalidStatus = await post(server.base, "/api/status", { ...originalStatus, vote: "APPROVE" });
  assert.equal(invalidStatus.status, 400);
  assert.deepEqual(await fetch(server.base + "/api/status").then((response) => response.json()), originalStatus);

  const incompleteFeedback = {
    slug: originalPlan.meta.slug,
    verdict: "approved",
    decisions: [],
    approvals: { positioning: "approve" },
    notes: "",
  };
  const invalidFeedback = await post(server.base, "/api/feedback", incompleteFeedback);
  assert.equal(invalidFeedback.status, 400);
  await assert.rejects(access(outputPath));
});

test("Horizon enforces approval semantics before accepting feedback", async (context) => {
  const temp = await mkdtemp(join(tmpdir(), "promper-horizon-gate-"));
  const planPath = join(ROOT, "test", "fixtures", "orbit-suite", "plan", "full.valid.json");
  const outputPath = join(temp, "feedback.json");
  const server = await startServer(planPath, outputPath);
  context.after(server.stop);
  const plan = await fetch(server.base + "/api/plan").then((response) => response.json());
  const approvals = Object.fromEntries(
    ["positioning", "evidence", "domainModel", "patterns", "risks", "openQuestions", "scope"]
      .map((key) => [key, "approve"]),
  );
  const valid = {
    slug: plan.meta.slug,
    verdict: "approved",
    decisions: [{ ref: "q1", answer: "100 req/min" }],
    approvals,
    notes: "",
  };

  assert.equal((await post(server.base, "/api/feedback", { ...valid, slug: "wrong" })).status, 400);
  assert.equal((await post(server.base, "/api/feedback", {
    ...valid,
    approvals: { ...approvals, risks: "change" },
  })).status, 400);
  assert.equal((await post(server.base, "/api/feedback", {
    ...valid,
    decisions: [{ ref: "q1", answer: " " }],
  })).status, 400);
  assert.equal((await post(server.base, "/api/feedback", {
    ...valid,
    verdict: "changes-requested",
  })).status, 400);
  await assert.rejects(access(outputPath));

  const accepted = await post(server.base, "/api/feedback", valid);
  assert.equal(accepted.status, 200);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), valid);
});

test("Horizon accepts malicious-looking tracker labels as literal state text", async (context) => {
  const temp = await mkdtemp(join(tmpdir(), "promper-horizon-text-"));
  const planPath = join(ROOT, "test", "fixtures", "orbit-suite", "plan", "minimal.valid.json");
  const outputPath = join(temp, "feedback.json");
  const server = await startServer(planPath, outputPath);
  context.after(server.stop);
  const label = "<img src=x onerror=globalThis.pwned=true>";
  const status = {
    run: { slug: "literal-text", engine: "breakdown", tribunal: "solo" },
    phases: [{ id: "genesis", label, status: "active" }],
    magi: { active: false, state: "idle", consensusReached: false, cores: [] },
  };
  assert.equal((await post(server.base, "/api/status", status)).status, 200);
  const roundTrip = await fetch(server.base + "/api/status").then((response) => response.json());
  assert.equal(roundTrip.phases[0].label, label);
});

test("Horizon rejects an invalid initial plan before writing snapshots", async () => {
  const temp = await mkdtemp(join(tmpdir(), "promper-horizon-initial-"));
  const planPath = join(temp, "invalid-plan.json");
  const outputPath = join(temp, "feedback.json");
  await writeFile(planPath, "{}\n", "utf8");
  const child = spawn(process.execPath, [SERVER, planPath, outputPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.notEqual(exitCode, 0);
  await assert.rejects(access(join(temp, "plan.snapshot.json")));
  await assert.rejects(access(outputPath));
});
