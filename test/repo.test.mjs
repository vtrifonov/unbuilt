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
