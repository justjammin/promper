import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(join(ROOT, relativePath), "utf8");
}

test("singularity skill has valid, explicit frontmatter", async () => {
  const source = await read("skills/singularity/SKILL.md");
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "frontmatter block is required");

  const frontmatter = yaml.load(match[1]);
  assert.equal(frontmatter.name, "singularity");
  assert.match(frontmatter.description, /\/promper:singularity/);
  assert.match(frontmatter.description, /Unlike `\/promper:breakdown`/);
  assert.match(frontmatter.description, /Plan-first by default/);
  assert.match(frontmatter.description, /always bounded/);
});

test("singularity contract covers the bounded runtime", async () => {
  const source = await read("skills/singularity/SKILL.md");
  const required = [
    "--run",
    "--max-orbits",
    "--max-nodes",
    "--threshold",
    "--stall-limit",
    "positive integers",
    "Phase 5: convergence check",
    "Phase 7: event-horizon checks",
    "## Resume",
    "SINGULARITY REACHED",
    "EVENT HORIZON REACHED",
    "researcher",
    "implementer",
    "planner",
    "orchestrator",
  ];

  for (const term of required) {
    assert.ok(source.includes(term), `missing contract term: ${term}`);
  }

  assert.match(source, /score >= threshold/);
  assert.match(source, /integer from 1 through\s+100/);
  assert.match(source, /every blocking criterion is `pass`/);
  assert.match(source, /every `pass` includes at least one concrete evidence reference/);
  assert.match(source, /marking it `pending`[\s\S]*interrupted-attempt note/);
  assert.match(source, /execute ready nodes sequentially inline/);
  assert.match(source, /max_orbits[\s\S]*max_nodes[\s\S]*stalled[\s\S]*duplicate_expansion/);
});

test("installer and docs expose singularity", async () => {
  const [bin, readme] = await Promise.all([
    read("bin/promper.mjs"),
    read("README.md"),
  ]);

  assert.match(bin, /const SKILLS = \[[^\]]*"singularity"/s);
  assert.match(readme, /## \/promper:singularity/);
  assert.match(readme, /\/promper:breakdown[\s\S]*Compile one finite project graph/);
  assert.match(readme, /\/promper:singularity[\s\S]*Execute and adapt a bounded graph/);
  assert.match(readme, /singularity\/SKILL\.md/);
});

test("generated manifests include the skills directory", async () => {
  const [claude, codex] = await Promise.all([
    read(".claude-plugin/plugin.json").then(JSON.parse),
    read(".codex-plugin/plugin.json").then(JSON.parse),
  ]);

  assert.equal(claude.skills, "./skills/");
  assert.equal(codex.skills, "./skills/");
  assert.match(claude.description, /bounded goal-directed graph execution/);
  assert.match(codex.description, /bounded goal-directed graph execution/);
});

test("site uses GSAP and Three.js for the singularity section", async () => {
  const source = await read("site/index.html");
  assert.match(source, /id="singularity"/);
  assert.match(source, /ScrollTrigger/);
  assert.match(source, /from "https:\/\/cdn\.jsdelivr\.net\/npm\/three/);
  assert.match(source, /prefers-reduced-motion/);
});
