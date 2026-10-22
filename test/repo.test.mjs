import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("package.json shape (R-REPO-5, layout table)", () => {
  assert.equal(pkg.name, "unbuilt");
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=22");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts.validate, "string");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(fs.existsSync(path.join(ROOT, "package-lock.json")), false);
});

test("LICENSE is MIT for Vasil Trifonov, 2026", () => {
  const text = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) 2026 Vasil Trifonov/);
});

test("plugin.json manifest (R-PKG-1)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(m.name, "unbuilt");
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof m.description, "string");
  assert.deepEqual(m.author, { name: "Vasil Trifonov" });
  assert.equal(m.repository, "https://github.com/vtrifonov/unbuilt");
  assert.equal(m.license, "MIT");
  for (const k of ["unbuilt", "spec", "skills"]) assert.ok(m.keywords.includes(k));
  for (const k of ["commands", "agents", "hooks", "mcpServers"]) assert.equal(m[k], undefined);
});

test("marketplace.json manifest (R-PKG-2)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(m.name, "unbuilt");
  assert.deepEqual(m.owner, { name: "Vasil Trifonov" });
  assert.equal(typeof m.description, "string"); assert.ok(m.description.length > 0);
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, "unbuilt");
  assert.ok(m.plugins[0].source === "." || m.plugins[0].source === "./");
  assert.equal(typeof m.plugins[0].description, "string");
});

test("ci.yml shape (R-CI-1..6)", () => {
  const y = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(y, /runs-on: ubuntu-latest/);
  assert.match(y, /node-version: 22\b/);
  assert.match(y, /actions\/checkout@v4/);
  assert.match(y, /actions\/setup-node@v4/);
  assert.match(y, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(y, /npm (ci|install)/);
  assert.doesNotMatch(y, /cache/);
  assert.doesNotMatch(y, /claude plugin validate/);
  const order = ["npm test", "node scripts/validate.mjs template", "node scripts/validate.mjs examples/clipjar"]
    .map((s) => y.indexOf(s));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2]);
});

import { RULES, SUPPORTED_FORMAT_VERSION } from "../scripts/lib/rules.mjs";
import { countWords } from "../scripts/lib/markdown.mjs";
const FORMAT = fs.readFileSync(path.join(ROOT, "FORMAT.md"), "utf8");
test("FORMAT.md names every rule, has the ten sections in order and the version line (R-FMT-1, R-FMT-2, R-FMT-4)", () => {
  for (const r of RULES) assert.ok(FORMAT.includes("`" + r.name + "`"), r.name);
  const titles = ["What an unbuilt repo is", "Version", "Required files", "Optional files", "Requirement IDs", "Modality", "Redaction rules", "Size budgets", "What builders are promised", "The YAML subset"];
  let last = -1;
  titles.forEach((t, i) => { const at = FORMAT.indexOf(`\n## ${i + 1}. ${t}\n`); assert.ok(at > last, t); last = at; });
  const v = FORMAT.match(/^Version: (\d+)$/m); assert.ok(v); assert.equal(Number(v[1]), SUPPORTED_FORMAT_VERSION);
  assert.ok(FORMAT.indexOf("Version: ") < FORMAT.indexOf("\n## 1. "));
  assert.ok(countWords(FORMAT) <= 2500, "FORMAT.md over 2,500 words");
});
