import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { makeTempDir, writeIn, readIn, REPO_ROOT } from "./helpers.mjs";
import { MAX_TEXT_BYTES } from "../scripts/lib/walk.mjs";
import { USAGE, JSON_ESCAPE_RE, sanitize, includeRule, scanInstance, readIncludedFile, InstanceError } from "../scripts/snapshot.mjs";

const SCRIPT = path.join(REPO_ROOT, "scripts", "snapshot.mjs");
const runSnapshot = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", timeout: 20000, ...opts });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const runDiff = (args) => {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "diff.mjs"), ...args], { encoding: "utf8", timeout: 20000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
function edit(dir, rel, from, to) {
  const t = readIn(dir, rel);
  assert.ok(t.includes(from), `${rel} lacks ${JSON.stringify(from)}`);
  writeIn(dir, rel, t.replace(from, to));
}
function makeInst(t) {
  const tmp = makeTempDir(t);
  fs.cpSync(path.join(REPO_ROOT, "template"), path.join(tmp, "inst"), { recursive: true });
  return { tmp, inst: path.join(tmp, "inst") };
}
const canSymlink = (tmp) => { try { fs.symlinkSync("x", path.join(tmp, ".probe")); fs.unlinkSync(path.join(tmp, ".probe")); return true; } catch { return false; } };
const unreadableSkip = () => process.platform === "win32" || process.getuid?.() === 0;
const mkfifo = (p) => process.platform !== "win32" && spawnSync("mkfifo", [p]).status === 0;

test("sanitize replaces every R-DIF-12 code point with ? (R-DIF-12)", () => {
  const UNSAFE = ["\u0000", "\u001f", "\u007f", "\u0085", "\u009f", "\u061c", "\u200b", "\u200d", "\u200e", "\u200f", "\u2028", "\u2029", "\u202a", "\u202e", "\u2060", "\u2066", "\u2069", "\ufe00", "\ufe0f", "\ufeff", "\u{e0000}", "\u{e0049}", "\u{e007f}"];
  for (const ch of UNSAFE) assert.equal(sanitize("a" + ch + "b"), "a?b");
  assert.equal(sanitize("\u00e9 \u00fc \u4e2d\u00a0"), "\u00e9 \u00fc \u4e2d\u00a0");
  for (const ch of UNSAFE) {
    if (ch.codePointAt(0) >= 0x7f) assert.equal(ch.replace(JSON_ESCAPE_RE, "?"), "?");
    else if (ch.codePointAt(0) < 0x20) assert.equal(ch.replace(JSON_ESCAPE_RE, "?"), ch);
  }
  assert.equal("\n".replace(JSON_ESCAPE_RE, "?"), "\n");
});

test("include rule keeps md text and root unbuilt.yaml and excludes agent files by name (R-SNP-1)", () => {
  const md = (p) => ({ path: p, kind: "file", ext: "md", isText: true });
  const rows = [
    [md("SPEC.md"), "include"],
    [md("docs/X.MD"), "include"],
    [{ path: "unbuilt.yaml", kind: "file", ext: "yaml", isText: false }, "include"],
    [{ path: "sub/unbuilt.yaml", kind: "file", ext: "yaml", isText: true }, "ignore"],
    [{ path: "design/screen.png", kind: "file", ext: "png", isText: false }, "ignore"],
    [{ path: "notes.txt", kind: "file", ext: "txt", isText: true }, "ignore"],
    [{ path: "bin.md", kind: "file", ext: "md", isText: false }, "ignore"],
    [md("CLAUDE.md"), "exclude"],
    [md("modules/core/agents.md"), "exclude"],
    [md("AGENT.md"), "exclude"],
    [md("claude.local.md"), "exclude"],
    [md("GEMINI.md"), "exclude"],
    [md(".hidden.md"), "exclude"],
    [md(".claude/commands/x.md"), "exclude"],
    [{ path: "README.md", kind: "symlink", ext: "md", isText: false }, "ignore"],
    [{ path: "x.md", kind: "fifo", ext: "md", isText: false }, "ignore"],
  ];
  for (const [entry, expected] of rows) assert.equal(includeRule(entry), expected, entry.path);
});

test("readIncludedFile refuses a symlinked file and a symlinked parent directory (R-SNP-6, R-SNP-8)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!canSymlink(tmp)) { t.skip("symbolic links cannot be created here"); return; }
  writeIn(tmp, "outside.md", "OUTSIDE-TEXT\n");
  writeIn(tmp, "outdir/x.md", "OUTSIDE-TEXT\n");
  fs.unlinkSync(path.join(inst, "README.md"));
  fs.symlinkSync(path.join(tmp, "outside.md"), path.join(inst, "README.md"));
  fs.symlinkSync(path.join(tmp, "outdir"), path.join(inst, "decisions"));
  for (const rel of ["README.md", "decisions/x.md"]) {
    assert.throws(() => readIncludedFile(inst, rel), (e) => e instanceof InstanceError && !e.message.includes("OUTSIDE-TEXT"), rel);
  }
});

test("readIncludedFile throws on a FIFO without blocking (R-SNP-6)", { timeout: 5000 }, (t) => {
  const { inst } = makeInst(t);
  fs.mkdirSync(path.join(inst, "decisions"));
  if (!mkfifo(path.join(inst, "decisions", "pipe.md"))) { t.skip("mkfifo is unavailable"); return; }
  assert.throws(() => readIncludedFile(inst, "decisions/pipe.md"), InstanceError);
});

test("readIncludedFile returns the exact bytes of a regular file (R-SNP-6)", (t) => {
  const { inst } = makeInst(t);
  assert.deepEqual(readIncludedFile(inst, "SPEC.md"), fs.readFileSync(path.join(inst, "SPEC.md")));
});

test("scanInstance fails on an over-cap, unreadable or too-numerous included set (R-SNP-2, R-SNP-3)", async (t) => {
  await t.test("over-cap file", (t) => {
    const { inst } = makeInst(t);
    writeIn(inst, "decisions/big.md", Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
    assert.throws(() => scanInstance(inst), (e) => e instanceof InstanceError && e.message === "decisions/big.md: larger than 5242880 bytes");
  });
  await t.test("unreadable included file", (t) => {
    if (unreadableSkip()) { t.skip("running as root or on Windows"); return; }
    const { inst } = makeInst(t);
    fs.chmodSync(path.join(inst, "modules/core/SPEC.md"), 0o000);
    assert.throws(() => scanInstance(inst), (e) => e instanceof InstanceError && e.message === "modules/core/SPEC.md: cannot be read");
  });
  await t.test("unreadable file under a dot component", (t) => {
    if (unreadableSkip()) { t.skip("running as root or on Windows"); return; }
    const { inst } = makeInst(t);
    writeIn(inst, ".cache/x.md", "x\n");
    fs.chmodSync(path.join(inst, ".cache/x.md"), 0o000);
    assert.doesNotThrow(() => scanInstance(inst));
  });
  await t.test("too many included files", (t) => {
    const { inst } = makeInst(t);
    fs.mkdirSync(path.join(inst, "decisions"));
    for (let i = 0; i < 10001; i++) fs.writeFileSync(path.join(inst, "decisions", `f${i}.md`), "");
    assert.throws(() => scanInstance(inst), (e) => e instanceof InstanceError && e.message === ".: more than 10000 included files");
  });
});

test("scanInstance fails when included files total more than 64 MB (R-SNP-3)", (t) => {
  const { inst } = makeInst(t);
  const buf = Buffer.alloc(MAX_TEXT_BYTES, 0x61);
  fs.mkdirSync(path.join(inst, "decisions"));
  for (let i = 0; i < 13; i++) fs.writeFileSync(path.join(inst, "decisions", `big${i}.md`), buf);
  assert.throws(() => scanInstance(inst), (e) => e instanceof InstanceError && e.message === ".: included files total more than 67108864 bytes");
});

test("scanInstance reports included, excluded and skipped entries (R-SNP-1, R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!canSymlink(tmp)) { t.skip("symbolic links cannot be created here"); return; }
  writeIn(inst, "CLAUDE.md", "# agent\n");
  fs.symlinkSync("README.md", path.join(inst, "notes.md"));
  const r = scanInstance(inst);
  const paths = r.included.map((e) => e.path);
  assert.ok(paths.includes("unbuilt.yaml"));
  assert.ok(paths.includes("SPEC.md"));
  assert.deepEqual(r.excluded, ["CLAUDE.md"]);
  assert.deepEqual(r.skipped, [{ path: "notes.md", kind: "symlink" }]);
});
