import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAGI = join(ROOT, "skills", "sideeye", "magi", "magi-orchestrator.mjs");
const HORIZON = join(ROOT, "skills", "horizon", "server", "horizon-server.mjs");

test("MAGI CLI accepts the exact core set and rejects duplicate or missing cores", async () => {
  const valid = join(ROOT, "test", "fixtures", "orbit-suite", "vote", "aggregate.valid.json");
  const duplicate = join(ROOT, "test", "fixtures", "orbit-suite", "vote", "aggregate-duplicate.invalid.json");
  const missing = join(ROOT, "test", "fixtures", "orbit-suite", "vote", "aggregate-missing.invalid.json");
  const unknown = join(ROOT, "test", "fixtures", "orbit-suite", "vote", "aggregate-unknown.invalid.json");
  const malformed = join(ROOT, "test", "fixtures", "orbit-suite", "vote", "aggregate-malformed.invalid.json");

  const ok = await run(process.execPath, [MAGI, "--votes", valid]);
  assert.match(ok.stdout, /Split approve/);
  await assert.rejects(run(process.execPath, [MAGI, "--votes", duplicate]), /duplicate|exact core/i);
  await assert.rejects(run(process.execPath, [MAGI, "--votes", missing]), /exactly 3|missing/i);
  await assert.rejects(run(process.execPath, [MAGI, "--votes", unknown]), /schema|core|enum/i);
  await assert.rejects(run(process.execPath, [MAGI, "--votes", malformed]), /schema|required|allowed values|enum/i);
});

test("Horizon export embeds a validated plan and renderer in one HTML file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "promper-horizon-export-"));
  const plan = join(ROOT, "test", "fixtures", "orbit-suite", "plan", "full.valid.json");
  const output = join(dir, "horizon.html");
  const invalid = join(dir, "invalid.json");
  const hostile = join(dir, "hostile.json");
  const hostileOutput = join(dir, "hostile.html");
  await run(process.execPath, [HORIZON, "export", plan, output]);
  const html = await readFile(output, "utf8");

  assert.match(html, /window\.__HORIZON_PLAN__/);
  assert.match(html, /Positioning/);
  assert.match(html, /Open questions/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.match(html, /embedded: Boolean\(globalThis\.__HORIZON_PLAN__\)/);
  assert.match(html, /function feedbackProblem\(feedback\)/);
  assert.match(html, /answer every blocking question/);
  assert.match(html, /downloadFeedback\(feedback\)/);

  await writeFile(invalid, "{}\n", "utf8");
  await assert.rejects(run(process.execPath, [HORIZON, "export", invalid, join(dir, "invalid.html")]), /invalid plan/i);

  const hostilePlan = JSON.parse(await readFile(plan, "utf8"));
  hostilePlan.positioning.problem = "</script><script>globalThis.pwned=true</script>";
  await writeFile(hostile, JSON.stringify(hostilePlan), "utf8");
  await run(process.execPath, [HORIZON, "export", hostile, hostileOutput]);
  const hostileHtml = await readFile(hostileOutput, "utf8");
  assert.doesNotMatch(hostileHtml, /<script>globalThis\.pwned=true<\/script>/);
  assert.match(hostileHtml, /\\u003c\/script\\u003e/);
});
