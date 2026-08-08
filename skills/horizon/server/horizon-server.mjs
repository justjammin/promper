// Horizon visual-validation server and portable exporter.
//
// Serve:
//   node server/horizon-server.mjs <plan.json> <out.feedback.json> [--port=4317]
// Export:
//   node server/horizon-server.mjs export <plan.json> <out.html>

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createHorizonValidators } from "./validation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HORIZON_ROOT = resolve(HERE, "..");
const TEMPLATE_DIR = join(HORIZON_ROOT, "template");
const TRACKER_DIR = resolve(HORIZON_ROOT, "..", "orbit", "viz");
const validators = await createHorizonValidators(HORIZON_ROOT);

function errorMessage(errors) {
  return errors.map((error) => error.message).join("; ");
}

function readValidatedPlan(path) {
  const plan = JSON.parse(readFileSync(resolve(path), "utf8"));
  const result = validators.plan(plan);
  if (!result.ok) throw new Error("invalid plan: " + errorMessage(result.errors));
  return plan;
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function exportHtml(planPath, outputPath) {
  const plan = readValidatedPlan(planPath);
  const shell = readFileSync(join(TEMPLATE_DIR, "index.html"), "utf8");
  const renderer = readFileSync(join(TEMPLATE_DIR, "render.js"), "utf8")
    .replace(/<\/script/gi, "<\\/script");
  const scripts =
    "<script>window.__HORIZON_PLAN__=" + safeScriptJson(plan) + ";</script>\n" +
    "<script type=\"module\">\n" + renderer + "\n</script>";
  const html = shell.replace(
    '<script type="module" src="./render.js"></script>',
    scripts,
  );
  const resolvedOutput = resolve(outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, html, "utf8");
  console.log("horizon: exported " + resolvedOutput);
}

function response(content, contentType, status = 200) {
  return new Response(content, {
    status,
    headers: { "content-type": contentType + "; charset=utf-8" },
  });
}

function badRequest(kind, errors) {
  return response(JSON.stringify({
    ok: false,
    error: {
      code: "invalid_" + kind,
      message: kind + " validation failed",
      details: errors,
    },
  }), "application/json", 400);
}

function startServer(planPath, outputPath, port) {
  let plan = readValidatedPlan(planPath);
  let feedback = null;
  let ended = false;
  let trackerStatus = {
    run: { slug: plan.meta.slug, engine: "breakdown", tribunal: "solo" },
    phases: ["genesis", "sideeye", "horizon", "execute", "review"].map((id, index) => ({
      id,
      label: id.toUpperCase(),
      status: index === 0 ? "active" : "pending",
    })),
    magi: { active: false, state: "idle", consensusReached: false, cores: [] },
  };

  const initialStatus = validators.status(trackerStatus);
  if (!initialStatus.ok) {
    throw new Error("invalid initial tracker status: " + errorMessage(initialStatus.errors));
  }

  const resolvedOutput = resolve(outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(
    join(dirname(resolvedOutput), "plan.snapshot.json"),
    JSON.stringify(plan, null, 2) + "\n",
    "utf8",
  );

  new Elysia({ adapter: node() })
    .get("/", () => response(readFileSync(join(TEMPLATE_DIR, "index.html"), "utf8"), "text/html"))
    .get("/render.js", () => response(readFileSync(join(TEMPLATE_DIR, "render.js"), "utf8"), "text/javascript"))
    .get("/tracker", () => response(readFileSync(join(TRACKER_DIR, "orbit-tracker.html"), "utf8"), "text/html"))
    .get("/api/status", () => trackerStatus)
    .post("/api/status", ({ body }) => {
      const result = validators.status(body);
      if (!result.ok) return badRequest("status", result.errors);
      trackerStatus = structuredClone(body);
      return { ok: true };
    })
    .get("/api/plan", () => plan)
    .post("/api/plan", ({ body }) => {
      const result = validators.plan(body);
      if (!result.ok) return badRequest("plan", result.errors);
      plan = structuredClone(body);
      return { ok: true };
    })
    .post("/api/feedback", ({ body }) => {
      const result = validators.feedback(body, plan);
      if (!result.ok) return badRequest("feedback", result.errors);
      const accepted = structuredClone(body);
      writeFileSync(resolvedOutput, JSON.stringify(accepted, null, 2) + "\n", "utf8");
      feedback = accepted;
      return { ok: true };
    })
    .get("/api/poll", async () => {
      const deadline = Date.now() + 25_000;
      while (!feedback && !ended && Date.now() < deadline) {
        await new Promise((resolvePoll) => setTimeout(resolvePoll, 250));
      }
      if (feedback) return { ready: true, feedback };
      if (ended) return { ready: true, ended: true };
      return { ready: false };
    })
    .post("/api/end", () => {
      ended = true;
      return { ok: true };
    })
    .listen(port, () => {
      console.log(
        "horizon: reviewing " + planPath + " at http://localhost:" + port +
        "  (feedback -> " + outputPath + ")",
      );
    });
}

const args = process.argv.slice(2);
if (args[0] === "export") {
  if (!args[1] || !args[2]) {
    throw new Error("usage: horizon-server.mjs export <plan.json> <out.html>");
  }
  exportHtml(args[1], args[2]);
} else {
  const [planPath, outputPath] = args.filter((arg) => !arg.startsWith("--"));
  const port = Number(args.find((arg) => arg.startsWith("--port="))?.split("=")[1] ?? 4317);
  if (!planPath || !outputPath) {
    throw new Error("usage: horizon-server.mjs <plan.json> <out.feedback.json> [--port=4317]");
  }
  startServer(planPath, outputPath, port);
}
