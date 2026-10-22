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

function tree(dir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...tree(dir, r));
    else if (ent.isFile()) out.push([r, fs.readFileSync(path.join(dir, r)).toString("base64")]);
  }
  return rel === "" ? out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) : out;
}
const includedOf = (tr) => tr.filter(([p]) => p === "unbuilt.yaml" || p.endsWith(".md"));
const lastLine = (s) => s.trimEnd().split("\n").pop();

test("copies the included set with identical bytes and never changes the instance (R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(inst, "design/screen.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  writeIn(inst, "notes.txt", "notes\n");
  const before = tree(inst);
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 0, r.stderr);
  const want = includedOf(before);
  assert.deepEqual(tree(dest), want);
  assert.equal(lastLine(r.stdout), `copied ${want.length} file(s)`);
  assert.deepEqual(tree(inst), before);
});

test("excludes agent files and dot paths by name (R-SNP-1, R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  const names = ["CLAUDE.md", "modules/core/agents.md", "AGENT.md", "CLAUDE.local.md", "GEMINI.md", ".claude/commands/x.md", ".hidden.md"];
  for (const n of names) writeIn(inst, n, "# agent\n");
  writeIn(inst, ".bad\u001bname.md", "# bad\n");
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 1, r.stderr);
  for (const n of names) {
    assert.ok(r.stdout.includes(`excluded ${n}\n`), n);
    assert.equal(fs.existsSync(path.join(dest, n)), false, n);
  }
  assert.ok(r.stdout.includes("excluded .bad?name.md\n"));
  assert.ok(!r.stdout.includes("\u001b"));
  assert.equal(runDiff([inst, dest]).code, 0);
});

test("skips symlinks without following them (R-SNP-6, R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!canSymlink(tmp)) { t.skip("symbolic links cannot be created here"); return; }
  const dest = path.join(tmp, "dest");
  writeIn(tmp, "outside.md", "OUTSIDE-TEXT\n");
  writeIn(tmp, "outdir/SPEC.md", "OUTSIDE-TEXT\n");
  fs.unlinkSync(path.join(inst, "README.md"));
  fs.symlinkSync(path.join(tmp, "outside.md"), path.join(inst, "README.md"));
  fs.symlinkSync(path.join(tmp, "outdir"), path.join(inst, "modules", "linked"));
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stdout.includes("skipped README.md (symlink)\n"));
  for (const [p, b64] of tree(dest)) assert.ok(!Buffer.from(b64, "base64").toString().includes("OUTSIDE-TEXT"), p);
  assert.equal(fs.existsSync(path.join(dest, "modules", "linked")), false);
});

test("skips a FIFO and does not block (R-SNP-6, R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  fs.mkdirSync(path.join(inst, "decisions"));
  if (!mkfifo(path.join(inst, "decisions", "pipe.md"))) { t.skip("mkfifo is unavailable"); return; }
  const r = runSnapshot([inst, path.join(tmp, "dest")]);
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stdout.includes("skipped decisions/pipe.md (fifo)"));
});

test("too many files leaves no destination (R-SNP-3)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  fs.mkdirSync(path.join(inst, "decisions"));
  for (let i = 0; i < 10001; i++) fs.writeFileSync(path.join(inst, "decisions", `f${i}.md`), "");
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.equal(fs.existsSync(dest), false);
});

test("copies names with shell metacharacters verbatim (R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  const names = ["$(touch marker).md", "-n.md", "it's.md"];
  for (const n of names) writeIn(inst, `decisions/${n}`, `# ${n}\n`);
  const r = runSnapshot([inst, dest], { cwd: tmp });
  assert.equal(r.code, 0, r.stderr);
  for (const n of names) assert.deepEqual(fs.readFileSync(path.join(dest, "decisions", n)), fs.readFileSync(path.join(inst, "decisions", n)), n);
  for (const d of [tmp, inst, REPO_ROOT]) assert.equal(fs.existsSync(path.join(d, "marker")), false, d);
});

test("refuses an existing destination (R-SNP-5)", async (t) => {
  await t.test("empty directory", (t) => {
    const { tmp, inst } = makeInst(t);
    const dest = path.join(tmp, "dest");
    fs.mkdirSync(dest);
    const r = runSnapshot([inst, dest]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.deepEqual(fs.readdirSync(dest), []);
  });
  await t.test("regular file", (t) => {
    const { tmp, inst } = makeInst(t);
    const dest = path.join(tmp, "dest");
    fs.writeFileSync(dest, "keep");
    const r = runSnapshot([inst, dest]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.equal(fs.readFileSync(dest, "utf8"), "keep");
  });
});

test("refuses a destination whose parent is a symlink (R-SNP-5)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!canSymlink(tmp)) { t.skip("symbolic links cannot be created here"); return; }
  fs.mkdirSync(path.join(tmp, "real"));
  fs.symlinkSync(path.join(tmp, "real"), path.join(tmp, "via"));
  const r = runSnapshot([inst, path.join(tmp, "via", "dest")]);
  assert.equal(r.code, 2);
  assert.deepEqual(fs.readdirSync(path.join(tmp, "real")), []);
});

test("refuses a destination inside the instance (R-SNP-5)", (t) => {
  const { inst } = makeInst(t);
  const before = tree(inst);
  const r = runSnapshot([inst, path.join(inst, "snap")]);
  assert.equal(r.code, 2);
  assert.deepEqual(tree(inst), before);
  assert.equal(fs.existsSync(path.join(inst, "snap")), false);
});

test("over-cap file exits 2 and names it (R-SNP-2, R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(inst, "decisions/big.md", Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.includes("decisions/big.md"), r.stderr);
  assert.equal(fs.existsSync(dest), false);
});

test("unreadable included file exits 2 (R-SNP-2)", (t) => {
  if (unreadableSkip()) { t.skip("running as root or on Windows"); return; }
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  fs.chmodSync(path.join(inst, "modules/core/SPEC.md"), 0o000);
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 2);
  assert.equal(fs.existsSync(dest), false);
});

test("internal error exits 2 with the message and stack (R-SNP-4)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(tmp, "boom.mjs", 'import fs from "node:fs";\nfs.mkdirSync = () => { throw new Error("boom"); };\n');
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "boom.mjs")).href, SCRIPT, inst, dest], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("internal error: boom\n"), r.stderr);
  assert.ok(r.stderr.split("\n")[1].length > 0);
  assert.equal(fs.existsSync(dest), false);
});

test("a failure after the destination exists removes it and sanitises the internal error (R-SNP-6, R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(tmp, "late.mjs", 'import fs from "node:fs";\nconst orig = fs.writeFileSync;\nlet n = 0;\nfs.writeFileSync = (...a) => { if (++n === 3) throw new Error("late\\u001b[31mRED"); return orig(...a); };\n');
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "late.mjs")).href, SCRIPT, inst, dest], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("internal error: late?[31mRED\n"), r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), r.stderr);
  assert.ok(r.stderr.split("\n")[2].length > 0);
  assert.equal(fs.existsSync(dest), false);
});

test("a newline inside an internal error message stays on one sanitised line (R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(tmp, "nl.mjs", 'import fs from "node:fs";\nconst orig = fs.writeFileSync;\nlet n = 0;\nfs.writeFileSync = (...a) => { if (++n === 3) throw new Error("late\\u001b[31mRED\\nnext: forged"); return orig(...a); };\n');
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "nl.mjs")).href, SCRIPT, inst, dest], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, "");
  const lines = r.stderr.split("\n");
  assert.equal(lines[0], "internal error: late?[31mRED?next: forged");
  assert.ok(!lines.some((l) => l.startsWith("next")), r.stderr);
  assert.ok(lines[1].length > 0);
  assert.equal(fs.existsSync(dest), false);
});

test("an over-cap file with a control character is named sanitised on stderr (R-SNP-7)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(inst, "decisions/big\u001b.md", Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
  const r = runSnapshot([inst, dest]);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.startsWith("decisions/big?.md: "), r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), r.stderr);
});

test("refuses a destination inside the instance spelled in another letter case (R-SNP-5, R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!fs.existsSync(path.join(tmp, "INST"))) { t.skip("the temp file system is case-sensitive"); return; }
  const before = tree(inst);
  const r = runSnapshot([inst, path.join(tmp, "INST", "snap")]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("destination is inside the instance: "), r.stderr);
  assert.deepEqual(tree(inst), before);
  assert.equal(fs.existsSync(path.join(inst, "snap")), false);
});

test("snapshot of a snapshot is identical (R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  const a = path.join(tmp, "a");
  const b = path.join(tmp, "b");
  assert.equal(runSnapshot([inst, a]).code, 0);
  assert.equal(runSnapshot([a, b]).code, 0);
  assert.deepEqual(tree(a), tree(b));
  assert.equal(runDiff([a, b]).code, 0);
});

test("usage errors exit 2 with the usage text (R-SNP-4)", (t) => {
  const { tmp, inst } = makeInst(t);
  const dest = path.join(tmp, "dest");
  writeIn(tmp, "plain.txt", "x\n");
  const cases = [[], [inst], [inst, dest, "x"], [inst, dest, "--json"], [path.join(tmp, "missing"), dest], [path.join(tmp, "plain.txt"), dest]];
  for (const args of cases) {
    const r = runSnapshot(args);
    const label = JSON.stringify(args);
    assert.equal(r.code, 2, label);
    assert.equal(r.stdout, "", label);
    assert.ok(r.stderr.endsWith(USAGE), label);
    assert.notEqual(r.stderr.split("\n")[0], "", label);
  }
  assert.equal(fs.existsSync(dest), false);
});

test("--help prints the usage (R-SNP-4)", () => {
  const r = runSnapshot(["--help"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, USAGE);
});

test("follows a symlinked instance root (Review Focus 1, R-SNP-6)", (t) => {
  const { tmp, inst } = makeInst(t);
  if (!canSymlink(tmp)) { t.skip("symbolic links cannot be created here"); return; }
  const link = path.join(tmp, "link");
  const dest = path.join(tmp, "dest");
  fs.symlinkSync(inst, link);
  const r = runSnapshot([link, dest]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(tree(dest), includedOf(tree(inst)));
});
