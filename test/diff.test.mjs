import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir, writeIn, readIn, REPO_ROOT } from "./helpers.mjs";
import { MAX_TEXT_BYTES } from "../scripts/lib/walk.mjs";
import { USAGE, formatHuman } from "../scripts/diff.mjs";

const SCRIPT = path.join(REPO_ROOT, "scripts", "diff.mjs");
const runDiff = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 20000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
function edit(dir, rel, from, to) {
  const t = readIn(dir, rel);
  assert.ok(t.includes(from), `${rel} lacks ${JSON.stringify(from)}`);
  writeIn(dir, rel, t.replace(from, to));
}
const canSymlink = (tmp) => { try { fs.symlinkSync("x", path.join(tmp, ".probe")); fs.unlinkSync(path.join(tmp, ".probe")); return true; } catch { return false; } };
const unreadableSkip = () => process.platform === "win32" || process.getuid?.() === 0;
const mkfifo = (p) => process.platform !== "win32" && spawnSync("mkfifo", [p]).status === 0;
function tree(dir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...tree(dir, r));
    else if (ent.isFile()) out.push([r, fs.readFileSync(path.join(dir, r)).toString("base64")]);
  }
  return rel === "" ? out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : out;
}
function sides(t) {
  const tmp = makeTempDir(t);
  for (const s of ["old", "new"]) fs.cpSync(path.join(REPO_ROOT, "template"), path.join(tmp, s), { recursive: true });
  return { tmp, oldDir: path.join(tmp, "old"), newDir: path.join(tmp, "new") };
}
function diffJson(t, mutate) {
  const c = sides(t);
  mutate?.(c);
  const r = runDiff([c.oldDir, c.newDir, "--json"]);
  return { ...c, ...r, json: r.code === 2 ? null : JSON.parse(r.stdout) };
}
const LISTS = { requirements: ["added", "changed", "modality", "inferred", "retired", "removed"], scenarios: ["added", "removed", "changed"], modules: ["added", "removed", "maturity"], substitutions: ["added", "removed", "changed"], milestones: ["added", "removed", "changed"], files: ["changed", "added", "removed"] };

test("no change exits 0 with every list empty (R-DIF-2, R-DIF-11, R-DIF-14)", (t) => {
  const { oldDir, newDir } = sides(t);
  const human = runDiff([oldDir, newDir]);
  assert.equal(human.code, 0, human.stderr);
  assert.equal(human.stdout, "no differences\n");
  const { code, json } = diffJson(t);
  assert.equal(code, 0);
  assert.equal(json.changed, false);
  assert.deepEqual(json.old, { name: "my-idea", unbuilt: 1 });
  assert.deepEqual(json.new, { name: "my-idea", unbuilt: 1 });
  assert.deepEqual(Object.keys(json), ["changed", "old", "new", ...Object.keys(LISTS)]);
  for (const [group, keys] of Object.entries(LISTS)) {
    assert.deepEqual(Object.keys(json[group]), keys, group);
    for (const k of keys) assert.deepEqual(json[group][k], [], `${group}.${k}`);
  }
});

test("same directory exits 0 (R-DIF-2)", () => {
  const template = path.join(REPO_ROOT, "template");
  const r = runDiff([template, template]);
  assert.equal(r.code, 0, r.stderr);
});

test("formatHuman prints no differences for an unchanged result (R-DIF-2)", () => {
  assert.equal(formatHuman({ changed: false }), "no differences\n");
});

test("ignores non-text, non-md, .git and excluded files (R-DIF-19, R-DIF-20, R-SNP-1)", (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const cases = [
    ({ newDir }) => {
      fs.mkdirSync(path.join(newDir, "design"), { recursive: true });
      fs.writeFileSync(path.join(newDir, "design", "screen.png"), png);
      writeIn(newDir, "notes.txt", "notes\n");
    },
    ({ newDir }) => writeIn(newDir, ".git/x.md", "# git\n"),
    ({ newDir }) => {
      for (const n of ["CLAUDE.md", "modules/core/agents.md", "GEMINI.md", ".claude/commands/x.md", ".hidden.md"]) writeIn(newDir, n, "# agent\n");
    },
  ];
  for (const mutate of cases) {
    const r = diffJson(t, mutate);
    assert.equal(r.code, 0, r.stderr);
  }
});

test("over-cap file on either side exits 2 with a side prefix (R-DIF-3, R-DIF-12)", (t) => {
  const big = "a".repeat(MAX_TEXT_BYTES + 1);
  for (const side of ["old", "new"]) {
    const r = diffJson(t, (c) => writeIn(side === "old" ? c.oldDir : c.newDir, "decisions/big\u001b.md", big));
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.startsWith(`${side}: `), r.stderr);
    assert.ok(r.stderr.includes("decisions/big?.md"));
    assert.ok(!r.stderr.includes("\u001b"));
  }
});

test("too many files exits 2 with the new prefix (R-SNP-3, R-DIF-3)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    fs.mkdirSync(path.join(newDir, "decisions"), { recursive: true });
    for (let i = 0; i < 10001; i++) fs.writeFileSync(path.join(newDir, "decisions", `f${i}.md`), "");
  });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("new: "), r.stderr);
});

test("unreadable file exits 2 and names it (R-SNP-2, R-DIF-3)", (t) => {
  if (unreadableSkip()) { t.skip("file modes do not apply here"); return; }
  const r = diffJson(t, ({ newDir }) => fs.chmodSync(path.join(newDir, "modules", "core", "SPEC.md"), 0o000));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("new: modules/core/SPEC.md"), r.stderr);
});

test("unparseable unbuilt.yaml exits 2 with the new prefix (R-DIF-3, R-DIF-23)", (t) => {
  const bad = diffJson(t, ({ newDir }) => edit(newDir, "unbuilt.yaml", "platforms: # lowercase tokens; a declined platform name becomes desktop, server or mobile\n  - desktop\n", "platforms: [desktop]\n"));
  assert.equal(bad.code, 2);
  assert.equal(bad.stdout, "");
  assert.ok(bad.stderr.startsWith("new: unbuilt.yaml"), bad.stderr);
  const gone = diffJson(t, ({ oldDir }) => fs.unlinkSync(path.join(oldDir, "unbuilt.yaml")));
  assert.equal(gone.code, 2);
  assert.ok(gone.stderr.startsWith("old: unbuilt.yaml: missing"), gone.stderr);
});

test("usage errors exit 2 without a side prefix (R-DIF-1, R-DIF-2)", (t) => {
  const { tmp, oldDir: a, newDir: b } = sides(t);
  writeIn(tmp, "plain.txt", "x\n");
  const file = path.join(tmp, "plain.txt");
  const missing = path.join(tmp, "missing");
  const cases = [[], [a], [a, b, a], [a, b, "--yaml"], [missing, b], [file, b]];
  const check = (args) => {
    const r = runDiff(args);
    const label = JSON.stringify(args);
    assert.equal(r.code, 2, label);
    assert.equal(r.stdout, "", label);
    assert.ok(r.stderr.endsWith(USAGE), label);
    assert.ok(!r.stderr.startsWith("old: "), label);
    assert.ok(!r.stderr.startsWith("new: "), label);
  };
  for (const args of cases) check(args);
  for (const args of cases.slice(0, 3)) check([...args, "--json"]);
});

test("--help prints the usage (R-DIF-1)", () => {
  const r = runDiff(["--help"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, USAGE);
});

test("internal errors exit 2 (R-DIF-4)", (t) => {
  const { tmp, oldDir, newDir } = sides(t);
  writeIn(tmp, "boom.mjs", 'globalThis.TextDecoder = class { decode() { throw new Error("boom"); } };\n');
  for (const extra of [[], ["--json"]]) {
    const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "boom.mjs")).href, SCRIPT, oldDir, newDir, ...extra], { encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.startsWith("internal error: boom\n"), r.stderr);
    assert.ok(r.stderr.split("\n")[1].length > 0);
  }
});
