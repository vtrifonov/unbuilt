import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCli, runJson, makeTempDir } from "./helpers.mjs";

test("--help prints usage and exits 0 (R-VAL-1)", () => {
  const r = runCli(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: node scripts\/validate\.mjs <instance-dir>/);
});

test("usage problems exit 2 with explanation and usage on stderr (R-VAL-2)", (t) => {
  const dir = makeTempDir(t);
  const file = path.join(dir, "f.txt"); fs.writeFileSync(file, "x");
  const cases = [[], [dir, dir], [dir, "--nope"], [dir, "--today", "2026-02-30"], [dir, "--today", "20260101"], [dir, "--today"], [path.join(dir, "missing")], [file]];
  for (const args of cases) {
    const r = runCli(args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /usage: node scripts\/validate\.mjs/);
    assert.ok(r.stderr.split("\n")[0].length > 0);
  }
});

test("--json prints exactly one document with errors and warnings arrays (R-VAL-6)", (t) => {
  const dir = makeTempDir(t);
  const r = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(Object.keys(r.result), ["errors", "warnings"]);
  assert.ok(Array.isArray(r.result.errors) && Array.isArray(r.result.warnings));
  for (const f of [...r.result.errors, ...r.result.warnings]) {
    assert.equal(typeof f.rule, "string"); assert.equal(typeof f.file, "string"); assert.equal(typeof f.message, "string");
    if ("line" in f) assert.equal(typeof f.line, "number");
  }
});
