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
