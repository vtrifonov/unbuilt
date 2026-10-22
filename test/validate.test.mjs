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

import { walkInstance } from "../scripts/lib/walk.mjs";

test("walk: lstat, skips .git, records node_modules and non-regular entries (R-VAL-12, R-VAL-13)", (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(path.join(dir, ".git")); fs.writeFileSync(path.join(dir, ".git/leak.md"), "ops@widgets-intranet.com");
  fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true }); fs.writeFileSync(path.join(dir, "node_modules/x/index.js"), "1");
  fs.writeFileSync(path.join(dir, "README.md"), "# hi");
  fs.writeFileSync(path.join(dir, "data.sqlite"), Buffer.from([0x53, 0x51, 0x00, 0x01]));
  fs.writeFileSync(path.join(dir, "Photo.PNG"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  let linked = true; try { fs.symlinkSync("README.md", path.join(dir, "link.md")); } catch { linked = false; }
  const { entries, dirs, nodeModulesDirs } = walkInstance(dir);
  const by = Object.fromEntries(entries.map((e) => [e.path, e]));
  assert.ok(dirs.includes("node_modules") && !dirs.includes(".git") && !dirs.includes("node_modules/x"));
  assert.equal(by[".git/leak.md"], undefined);
  assert.equal(by["node_modules/x/index.js"], undefined);
  assert.deepEqual(nodeModulesDirs, ["node_modules"]);
  assert.equal(by["README.md"].kind, "file"); assert.equal(by["README.md"].isText, true);
  assert.equal(by["data.sqlite"].isText, false); assert.equal(by["data.sqlite"].isRaster, false);
  assert.equal(by["Photo.PNG"].ext, "png"); assert.equal(by["Photo.PNG"].isRaster, true); assert.equal(by["Photo.PNG"].isText, false);
  if (linked) assert.equal(by["link.md"].kind, "symlink");
});

import { blankCommentsAndFences, countLines, countWords, findAttempts, findCitations, findScenarioSections } from "../scripts/lib/markdown.mjs";

test("blankCommentsAndFences keeps line numbers and removes fences and comments (R-VAL-18, R-FMT-29)", () => {
  const src = "a\n```\n- **CORE-1** (MUST) hidden\n```\n<!-- CORE-2\nstill -->\nb CORE-3\n";
  const out = blankCommentsAndFences(src);
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.doesNotMatch(out, /CORE-1|CORE-2/);
  assert.match(out, /CORE-3/);
  assert.equal(findAttempts(out, ["CORE"]).length, 0);
  assert.deepEqual(findCitations(out, ["CORE"]).map((c) => [c.id, c.line]), [["CORE-3", 7]]);
});
test("countLines and countWords (R-FMT-38)", () => {
  assert.equal(countLines(""), 0); assert.equal(countLines("a\nb\n"), 2); assert.equal(countLines("a\nb"), 2);
  assert.equal(countWords("a b\n\n c\n"), 3);
  // Comments and fence lines count (R-FMT-38): the 9 tokens are `<!--`, `a`, `b`, `-->`, the opening fence, `c`, the closing fence, `d`, `e`.
  assert.equal(countWords("<!-- a b -->\n```\nc\n```\n d  e\n"), 9);
});
test("findAttempts classifies declaration attempts (R-VAL-22)", () => {
  const prose = ["- **CORE-1** (MUST) Text.", "- **CORE-2** (MUST) (inferred) Text.", "- **CORE-3** retired: moved", "* **CORE-4** (MUST) star", "  - **CORE-5** (MUST) indented",
    "- **UTF-8**: encoding", "- **PICK-1** (must) other", "- **CORE-6** (MUST) retired", "- **CORE-7** Retired: x", "- **CORE-8** MUST no parens", "- **CORE-4** (MUST) Show retired clips in grey.", "- **core-9** (MUST) lower", "- **CORE-01** (MUST) zero"].join("\n");
  const a = findAttempts(prose, ["CORE"]);
  assert.deepEqual(a.map((x) => x.line), [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(a[0].exact.modality, "MUST"); assert.equal(a[1].exact.inferred, true); assert.equal(a[2].exact.retired, true);
  assert.equal(a[3].bullet, "*"); assert.equal(a[3].exact, null); assert.equal(a[4].indented, true);
  assert.equal(a[5].prefix, "PICK"); assert.equal(a[5].exact, null);
  assert.equal(a[6].retiredShaped, true); assert.equal(a[7].retiredShaped, true); assert.equal(a[7].exact, null);
  assert.equal(a[8].exact, null); assert.equal(a[9].exact.text, "Show retired clips in grey."); assert.equal(a[9].retiredShaped, false);
  assert.equal(a[10].exact, null); assert.equal(a[11].exact, null);
});
test("findScenarioSections (R-FMT-18)", () => {
  const s = findScenarioSections("intro CORE-1\n## One\nbody\n### sub\n##NotOne\n## Two\n");
  assert.deepEqual(s, [{ title: "One", startLine: 2, endLine: 5 }, { title: "Two", startLine: 6, endLine: 6 }]);
});
