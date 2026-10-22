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

test("internal errors are sanitised on every stderr line (R-DIF-4, R-DIF-12)", (t) => {
  const { tmp, oldDir, newDir } = sides(t);
  writeIn(tmp, "esc.mjs", 'globalThis.TextDecoder = class { decode() { throw new Error("late\\u001b[31mRED"); } };\n');
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "esc.mjs")).href, SCRIPT, oldDir, newDir], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith("internal error: late?[31mRED\n"), r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), r.stderr);
  assert.ok(r.stderr.split("\n")[1].length > 0);
});

test("a newline inside an internal error message stays on one sanitised line (R-DIF-4, R-DIF-12)", (t) => {
  const { tmp, oldDir, newDir } = sides(t);
  writeIn(tmp, "nl.mjs", 'globalThis.TextDecoder = class { decode() { throw new Error("late\\u001b[31mRED\\nnext: forged"); } };\n');
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(tmp, "nl.mjs")).href, SCRIPT, oldDir, newDir], { encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, "");
  const lines = r.stderr.split("\n");
  assert.equal(lines[0], "internal error: late?[31mRED?next: forged");
  assert.ok(!lines.some((l) => l.startsWith("next")), r.stderr);
  assert.ok(lines[1].length > 0);
});

test("an over-cap file with a control character is named sanitised on stderr (R-DIF-3, R-DIF-12)", (t) => {
  const { oldDir, newDir } = sides(t);
  writeIn(newDir, "decisions/big\u001b.md", Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61));
  const r = runDiff([oldDir, newDir]);
  assert.equal(r.code, 2);
  assert.ok(r.stderr.startsWith("new: decisions/big?.md: "), r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), r.stderr);
});

const CORE = "modules/core/SPEC.md";
const CORE2 = "- **CORE-2** (SHOULD) Saved notes are listed newest first.";
const INV1 = "- **INV-1** (MUST) A note never leaves the machine it was typed on.\n";
const reqEmpty = (json, except = []) => {
  for (const k of LISTS.requirements) if (!except.includes(k)) assert.deepEqual(json.requirements[k], [], `requirements.${k}`);
};
const append = (dir, rel, text) => writeIn(dir, rel, readIn(dir, rel) + text);

test("JSON shape is fixed under change (R-DIF-13, R-DIF-14)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, "**CORE-2** (SHOULD)", "**CORE-2** (MUST)"));
  assert.ok(r.stdout.endsWith("}\n"));
  assert.equal(r.code, 1);
  assert.equal(r.json.changed, true);
  assert.deepEqual(Object.keys(r.json), ["changed", "old", "new", ...Object.keys(LISTS)]);
  for (const [group, keys] of Object.entries(LISTS)) assert.deepEqual(Object.keys(r.json[group]), keys, group);
  assert.deepEqual(r.json.old, { name: "my-idea", unbuilt: 1 });
  assert.deepEqual(r.json.new, { name: "my-idea", unbuilt: 1 });
});

test("requirement added (R-DIF-27, R-DIF-18)", (t) => {
  const r = diffJson(t, ({ newDir }) => append(newDir, CORE, "- **CORE-3** (MAY) (inferred) Notes can be pinned.\n"));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.requirements.added, [{ id: "CORE-3", modality: "MAY", inferred: true, file: CORE, line: 7 }]);
  reqEmpty(r.json, ["added"]);
  for (const k of LISTS.files) assert.deepEqual(r.json.files[k], []);
});

test("text changed (R-DIF-25, R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, "A note is saved", "A note is stored"));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.requirements.changed, [{ id: "CORE-1", file: CORE, line: 5, old_line: 5 }]);
  assert.deepEqual(r.json.requirements.modality, []);
  assert.deepEqual(r.json.requirements.inferred, []);
});

test("modality only (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, "**CORE-2** (SHOULD)", "**CORE-2** (MUST)"));
  assert.deepEqual(r.json.requirements.modality, [{ id: "CORE-2", from: "SHOULD", to: "MUST" }]);
  assert.deepEqual(r.json.requirements.changed, []);
});

test("text and modality (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, CORE2, "- **CORE-2** (MUST) Saved notes are listed oldest first."));
  assert.deepEqual(r.json.requirements.changed.map((e) => e.id), ["CORE-2"]);
  assert.deepEqual(r.json.requirements.modality.map((e) => e.id), ["CORE-2"]);
});

test("inferred only (R-DIF-25, R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, "**CORE-1** (MUST) A note", "**CORE-1** (MUST) (inferred) A note"));
  assert.deepEqual(r.json.requirements.inferred, [{ id: "CORE-1", from: false, to: true }]);
  assert.deepEqual(r.json.requirements.changed, []);
});

test("retired (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, CORE2, "- **CORE-2** retired: replaced by sort options."));
  assert.deepEqual(r.json.requirements.retired, [{ id: "CORE-2", file: CORE, line: 6 }]);
});

test("retired reason only is no change (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    edit(oldDir, CORE, CORE2, "- **CORE-2** retired: old reason.");
    edit(newDir, CORE, CORE2, "- **CORE-2** retired: new reason.");
  });
  assert.equal(r.code, 0, r.stderr);
});

test("removed (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, `${CORE2}\n`, ""));
  assert.deepEqual(r.json.requirements.removed, [{ id: "CORE-2", old_file: CORE }]);
});

test("removed retired (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    edit(oldDir, CORE, CORE2, "- **CORE-2** retired: gone.");
    edit(newDir, CORE, `${CORE2}\n`, "");
  });
  assert.deepEqual(r.json.requirements.removed, [{ id: "CORE-2", old_file: CORE }]);
});

test("un-retired and newly retired IDs (R-DIF-27)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    edit(oldDir, CORE, CORE2, "- **CORE-2** retired: gone.");
    append(newDir, CORE, "- **CORE-4** retired: never shipped.\n");
  });
  assert.deepEqual(r.json.requirements.added.map((e) => e.id), ["CORE-2"]);
  assert.deepEqual(r.json.requirements.retired, []);
});

test("an ID moved between files unchanged is not reported (R-DIF-27)", (t) => {
  const line = "- **CORE-1** (MUST) A note is saved when the user presses the capture key.";
  const r = diffJson(t, ({ newDir }) => {
    edit(newDir, CORE, `${line}\n`, "");
    edit(newDir, "SPEC.md", INV1, `${INV1}${line}\n`);
  });
  reqEmpty(r.json);
  for (const k of LISTS.files) assert.deepEqual(r.json.files[k], [], k);
});

test("invariant added (R-DIF-24)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "SPEC.md", INV1, `${INV1}- **INV-2** (MUST) Notes survive a restart.\n`));
  assert.deepEqual(r.json.requirements.added, [{ id: "INV-2", modality: "MUST", inferred: false, file: "SPEC.md", line: 23 }]);
});

test("fenced and commented declarations are ignored (R-DIF-24)", (t) => {
  const fence = "`".repeat(3);
  const r = diffJson(t, ({ newDir }) => append(newDir, CORE, `${fence}\n- **CORE-9** (MUST) Hidden.\n${fence}\n<!--\n- **CORE-9** (MUST) Hidden.\n-->\n`));
  reqEmpty(r.json);
  assert.deepEqual(r.json.files.changed, [CORE]);
});

test("first declaration wins (R-DIF-26)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "SPEC.md", INV1, `${INV1}- **CORE-1** (MUST) A different text.\n`));
  assert.deepEqual(r.json.requirements.changed, [{ id: "CORE-1", file: "SPEC.md", line: 23, old_line: 5 }]);
});

test("requirement IDs sort numerically (R-DIF-17)", (t) => {
  const r = diffJson(t, ({ newDir }) => append(newDir, CORE, "- **CORE-10** (MUST) Ten.\n- **CORE-3** (MUST) Three.\n"));
  assert.deepEqual(r.json.requirements.added.map((e) => e.id), ["CORE-3", "CORE-10"]);
});

const SYNC_YAML = "  - id: SYNC\n    path: modules/sync\n    maturity: sketched\n";
const CORE_MATURITY = "    maturity: shipped # shipped | partial | sketched | abandoned\n";
const CORE_SCEN = "modules/core/scenarios.md";
const PIN = "\n## Pin a note\n\nCovers: CORE-1\nGiven a saved note\nWhen the user pins it\nThen it stays on top\n";
function addSync(dir) {
  edit(dir, "unbuilt.yaml", CORE_MATURITY, CORE_MATURITY + SYNC_YAML);
  writeIn(dir, "modules/sync/problem.md", "# Problem\n\nNotes stay on one device.\n");
  writeIn(dir, "modules/sync/SPEC.md", "# Sync\n\n- **SYNC-1** (MUST) Notes sync on demand.\n");
  writeIn(dir, "modules/sync/scenarios.md", "# Scenarios\n\n## Sync now\n\nCovers: SYNC-1\nGiven a note\nWhen the user syncs\nThen it is copied\n");
}

test("scenarios added, removed and changed (R-DIF-30, R-DIF-31)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    edit(newDir, CORE_SCEN, "## List notes", "## List saved notes");
    edit(newDir, CORE_SCEN, "types a short note", "types a short line");
    append(newDir, CORE_SCEN, PIN);
  });
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.scenarios.added, [{ module: "CORE", title: "List saved notes", cites: ["CORE-2"] }, { module: "CORE", title: "Pin a note", cites: ["CORE-1"] }]);
  assert.deepEqual(r.json.scenarios.removed, [{ module: "CORE", title: "List notes", cites: ["CORE-2"] }]);
  assert.deepEqual(r.json.scenarios.changed, [{ module: "CORE", title: "Capture a note", cites: ["CORE-1", "INV-1"] }]);
});

test("duplicate scenario titles form one key (R-DIF-31)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    const dup = "\n## Capture a note\n\nCovers: CORE-2\nGiven x\n";
    append(oldDir, CORE_SCEN, dup);
    append(newDir, CORE_SCEN, dup);
    edit(newDir, CORE_SCEN, "Given x", "Given y");
  });
  assert.deepEqual(r.json.scenarios.changed, [{ module: "CORE", title: "Capture a note", cites: ["CORE-1", "CORE-2", "INV-1"] }]);
  assert.deepEqual(r.json.scenarios.added, []);
  assert.deepEqual(r.json.scenarios.removed, []);
});

test("appending a scenario reports only the added scenario (R-DIF-30, R-DIF-31, plan decision 10)", (t) => {
  const r = diffJson(t, ({ newDir }) => append(newDir, CORE_SCEN, PIN));
  assert.deepEqual(r.json.scenarios, { added: [{ module: "CORE", title: "Pin a note", cites: ["CORE-1"] }], removed: [], changed: [] });
});

test("a heading inside a fence is not a scenario (R-DIF-30)", (t) => {
  const fence = "`".repeat(3);
  const r = diffJson(t, ({ newDir }) => append(newDir, CORE_SCEN, `\n${fence}\n## Not a scenario\n${fence}\n`));
  assert.deepEqual(r.json.scenarios.added, []);
});

test("module added (R-DIF-34)", (t) => {
  const r = diffJson(t, ({ newDir }) => addSync(newDir));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.modules.added, [{ id: "SYNC", maturity: "sketched" }]);
  assert.ok(r.json.requirements.added.map((e) => e.id).includes("SYNC-1"));
  assert.deepEqual(r.json.scenarios.added, [{ module: "SYNC", title: "Sync now", cites: ["SYNC-1"] }]);
  for (const k of LISTS.files) assert.ok(!r.json.files[k].some((f) => f.startsWith("modules/sync/")), k);
});

test("module removed (R-DIF-34)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    for (const d of [oldDir, newDir]) {
      addSync(d);
      append(d, "BUILD.md", "\n## Milestone 2: Sync\n\nCovers: SYNC-1\nDone when: notes sync.\nEffort: S\n");
    }
    for (const rel of ["unbuilt.yaml", "BUILD.md"]) writeIn(newDir, rel, fs.readFileSync(path.join(REPO_ROOT, "template", rel)));
    fs.rmSync(path.join(newDir, "modules", "sync"), { recursive: true });
  });
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(r.json.modules.removed, [{ id: "SYNC" }]);
  assert.deepEqual(r.json.requirements.removed, [{ id: "SYNC-1", old_file: "modules/sync/SPEC.md" }]);
  assert.deepEqual(r.json.scenarios.removed, [{ module: "SYNC", title: "Sync now", cites: ["SYNC-1"] }]);
});

test("maturity change (R-DIF-34)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "unbuilt.yaml", "maturity: shipped #", "maturity: partial #"));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.modules.maturity, [{ id: "CORE", from: "shipped", to: "partial" }]);
  for (const k of LISTS.files) assert.ok(!r.json.files[k].includes("unbuilt.yaml"), k);
});

test("module path with a trailing slash (R-DIF-23)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    for (const d of [oldDir, newDir]) edit(d, "unbuilt.yaml", "path: modules/core #", "path: modules/core/ #");
    edit(newDir, CORE, "**CORE-2** (SHOULD)", "**CORE-2** (MUST)");
  });
  assert.deepEqual(r.json.requirements.modality, [{ id: "CORE-2", from: "SHOULD", to: "MUST" }]);
  reqEmpty(r.json, ["modality"]);
  for (const k of LISTS.files) assert.ok(!r.json.files[k].includes(CORE), k);
});

test("a module path never escapes the side (R-DIF-23)", (t) => {
  const check = (r) => {
    for (const out of [r.stdout, runDiff([r.oldDir, r.newDir]).stdout]) {
      for (const s of ["CORE-77", "OUTSIDE-TEXT", "OUTSIDE-TITLE"]) assert.ok(!out.includes(s), s);
    }
    assert.deepEqual(r.json.requirements.added.map((e) => e.id), ["CORE-1", "CORE-2"]);
  };
  check(diffJson(t, ({ tmp, oldDir }) => {
    edit(oldDir, "unbuilt.yaml", "path: modules/core #", "path: ../outside #");
    writeIn(tmp, "outside/SPEC.md", "- **CORE-77** (MUST) OUTSIDE-TEXT.\n");
    writeIn(tmp, "outside/scenarios.md", "## OUTSIDE-TITLE\n\nCovers: CORE-77\n");
  }));
  if (!canSymlink(makeTempDir(t))) return;
  check(diffJson(t, ({ tmp, oldDir }) => {
    fs.cpSync(path.join(REPO_ROOT, "template", "modules", "core"), path.join(tmp, "outside2"), { recursive: true });
    append(path.join(tmp, "outside2"), "SPEC.md", "- **CORE-77** (MUST) OUTSIDE-TEXT.\n");
    append(path.join(tmp, "outside2"), "scenarios.md", "\n## OUTSIDE-TITLE\n\nCovers: CORE-77\n");
    fs.rmSync(path.join(oldDir, "modules", "core"), { recursive: true });
    fs.symlinkSync(path.join(tmp, "outside2"), path.join(oldDir, "modules", "core"));
  }));
});

test("malformed module entries are ignored (Review Focus 5)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "unbuilt.yaml", CORE_MATURITY, `${CORE_MATURITY}  - id: 7\n    path: modules/core\n    maturity: shipped\n  - id: CORE\n    path: modules/other\n    maturity: sketched\n`));
  assert.equal(r.code, 0, r.stderr);
});

const SUBS_COMMENT = "# substitutions: list of kebab-case names, each needs substitutions/<name>.md\n";
function addSubs(dir, names, body = "Contract text.\n") {
  edit(dir, "unbuilt.yaml", SUBS_COMMENT, "substitutions:\n" + names.map((n) => `  - ${n}\n`).join(""));
  writeIn(dir, "substitutions/README.md", "# Substitutions\n\n| Module | storage |\n|---|---|\n| CORE | required |\n");
  for (const n of names) writeIn(dir, `substitutions/${n}.md`, `# ${n}\n\n${body}`);
}
const noChange = { number: 1, covers_added: [], covers_removed: [], title_changed: false };

test("substitutions added and changed (R-DIF-35)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    addSubs(oldDir, ["storage"]);
    addSubs(newDir, ["storage", "clipboard-api"]);
    edit(newDir, "substitutions/storage.md", "Contract text.", "New contract text.");
  });
  assert.deepEqual(r.json.substitutions, { added: ["clipboard-api"], removed: [], changed: ["storage"] });
  for (const k of LISTS.files) assert.ok(!r.json.files[k].some((f) => f.startsWith("substitutions/")), k);
});

test("substitution removed (R-DIF-35)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    addSubs(oldDir, ["legacy", "storage"]);
    addSubs(newDir, ["storage"]);
  });
  assert.deepEqual(r.json.substitutions.removed, ["legacy"]);
  assert.deepEqual(r.json.substitutions.changed, []);
});

test("milestone covers changed (R-DIF-36, R-DIF-37)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    append(newDir, CORE, "- **CORE-3** (MAY) Notes can be pinned.\n");
    edit(newDir, "BUILD.md", "Covers: CORE-1, CORE-2, INV-1", "Covers: CORE-1, CORE-2, CORE-3, INV-1");
  });
  assert.deepEqual(r.json.milestones.changed, [{ number: 1, covers_added: ["CORE-3"], covers_removed: [], title_changed: false }]);
});

test("milestone text only (R-DIF-37)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "BUILD.md", "Done when: a note typed", "Done when: a note entered"));
  assert.deepEqual(r.json.milestones.changed, [noChange]);
});

test("milestone title changed (R-DIF-37)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "BUILD.md", "## Milestone 1: Capture and list a note", "## Milestone 1: Capture a note"));
  assert.equal(r.json.milestones.changed[0].title_changed, true);
  assert.deepEqual(r.json.milestones.changed[0].covers_added, []);
  assert.deepEqual(r.json.milestones.changed[0].covers_removed, []);
});

test("milestone comment only (R-DIF-37)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "BUILD.md", "Covers: requirement IDs. Done when", "Covers: the requirement IDs. Done when"));
  assert.deepEqual(r.json.milestones.changed, [noChange]);
  for (const k of LISTS.files) assert.ok(!r.json.files[k].includes("BUILD.md"), k);
});

test("milestone added (R-DIF-37, plan decision 10)", (t) => {
  const r = diffJson(t, ({ newDir }) => append(newDir, "BUILD.md", "\n## Milestone 2: List notes\n\nCovers: CORE-2\nDone when: the list shows newest first.\nEffort: S\n"));
  assert.deepEqual(r.json.milestones, { added: [{ number: 2, title: "List notes" }], removed: [], changed: [] });
});

test("a repeated milestone number keeps the first (R-DIF-36)", (t) => {
  const r = diffJson(t, ({ oldDir, newDir }) => {
    for (const d of [oldDir, newDir]) append(d, "BUILD.md", "\n## Milestone 1: Duplicate\n\nCovers: CORE-2\n");
    edit(newDir, "BUILD.md", "Covers: CORE-2\n", "Covers: INV-1\n");
  });
  assert.deepEqual(r.json.milestones, { added: [], removed: [], changed: [] });
  assert.deepEqual(r.json.files.changed, ["BUILD.md"]);
});

const proseEdit = ({ newDir }) => {
  edit(newDir, "constraints.md", "Notes MUST be stored on the local disk only.", "Notes MUST be stored on the local disk and nowhere else.");
  writeIn(newDir, "decisions/keep-local.md", "# Keep local\n");
};
const moveCore = (c) => {
  fs.renameSync(path.join(c.newDir, "modules", "core"), path.join(c.newDir, "modules", "notes"));
  edit(c.newDir, "unbuilt.yaml", "path: modules/core #", "path: modules/notes #");
};

test("declaration-only SPEC change is not a file change (R-DIF-40)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE, "A note is saved when", "A note is stored when"));
  assert.equal(r.code, 1);
  for (const k of LISTS.files) assert.ok(!r.json.files[k].includes(CORE), k);
});

test("prose file changed and added (R-DIF-38)", (t) => {
  const r = diffJson(t, proseEdit);
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.files, { changed: ["constraints.md"], added: ["decisions/keep-local.md"], removed: [] });
});

test("module path moved (R-DIF-41, R-DIF-43)", (t) => {
  const r = diffJson(t, moveCore);
  assert.equal(r.code, 1, r.stderr);
  reqEmpty(r.json);
  assert.deepEqual(r.json.scenarios, { added: [], removed: [], changed: [] });
  assert.deepEqual(r.json.files, { changed: ["unbuilt.yaml"], added: [], removed: [] });
});

test("problem.md compared by module ID (R-DIF-41)", (t) => {
  const r = diffJson(t, (c) => {
    moveCore(c);
    edit(c.newDir, "modules/notes/problem.md", "Thoughts fade", "Ideas fade");
  });
  assert.deepEqual(r.json.files, { changed: ["modules/notes/problem.md", "unbuilt.yaml"], added: [], removed: [] });
});

test("scenarios.md preamble change is a file change (R-DIF-40)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, CORE_SCEN, "# Scenarios\n", "# Scenarios of core\n"));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json.files, { changed: [CORE_SCEN], added: [], removed: [] });
  assert.deepEqual(r.json.scenarios, { added: [], removed: [], changed: [] });
});

test("symlinked file reads as removed (R-DIF-19)", (t) => {
  if (!canSymlink(makeTempDir(t))) { t.skip("no symlink support"); return; }
  const r = diffJson(t, ({ tmp, newDir }) => {
    writeIn(tmp, "readme.md", "LINK-TARGET-TEXT\n");
    fs.rmSync(path.join(newDir, "README.md"));
    fs.symlinkSync(path.join(tmp, "readme.md"), path.join(newDir, "README.md"));
  });
  assert.deepEqual(r.json.files, { changed: [], added: [], removed: ["README.md"] });
  assert.ok(!r.stdout.includes("LINK-TARGET-TEXT"));
  assert.ok(!runDiff([r.oldDir, r.newDir]).stdout.includes("LINK-TARGET-TEXT"));
});

test("CRLF and BOM only is no change (R-DIF-22)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    for (const [rel] of tree(newDir)) {
      if (rel.endsWith(".md") || rel === "unbuilt.yaml") writeIn(newDir, rel, readIn(newDir, rel).replace(/\n/g, "\r\n"));
    }
    writeIn(newDir, "SPEC.md", "\ufeff" + readIn(newDir, "SPEC.md"));
  });
  assert.equal(r.code, 0, r.stderr);
});

test("unbuilt.yaml key order is not a change (Review Focus 2, R-DIF-43)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    const lines = readIn(newDir, "unbuilt.yaml").split("\n");
    const a = lines.findIndex((l) => l.startsWith("license:"));
    const b = lines.findIndex((l) => l.startsWith("has_ui:"));
    [lines[a], lines[b]] = [lines[b], lines[a]];
    writeIn(newDir, "unbuilt.yaml", lines.join("\n"));
  });
  assert.equal(r.code, 0, r.stderr);
});

test("unbuilt.yaml value change is a file change (R-DIF-43)", (t) => {
  const r = diffJson(t, ({ newDir }) => edit(newDir, "unbuilt.yaml", "summary: Captures a short note", "summary: Captures one short note"));
  assert.deepEqual(r.json.files.changed, ["unbuilt.yaml"]);
});

test("an accounted file missing on one side (Review Focus 3)", (t) => {
  const r = diffJson(t, ({ newDir }) => fs.unlinkSync(path.join(newDir, "BUILD.md")));
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(r.json.milestones.removed, [{ number: 1, title: "Capture and list a note" }]);
  assert.deepEqual(r.json.files.removed, ["BUILD.md"]);
});

test("module directory prefix does not swallow siblings (Review Focus 4, R-DIF-39)", (t) => {
  const r = diffJson(t, ({ newDir }) => {
    addSync(newDir);
    writeIn(newDir, "modules/sync2/notes.md", "# Notes\n");
  });
  assert.deepEqual(r.json.files.added, ["modules/sync2/notes.md"]);
});

test("a module path invalid on one side only (R-DIF-23, R-DIF-39, plan decision 4)", (t) => {
  const r = diffJson(t, ({ oldDir }) => edit(oldDir, "unbuilt.yaml", "path: modules/core #", "path: ../outside #"));
  assert.equal(r.code, 1, r.stderr);
  assert.deepEqual(r.json.files, { changed: ["unbuilt.yaml"], added: [], removed: [CORE, CORE_SCEN] });
  assert.deepEqual(r.json.requirements.added.map((e) => e.id), ["CORE-1", "CORE-2"]);
  assert.ok(r.json.scenarios.added.length > 0);
});

test("writes nothing (R-DIF-6)", (t) => {
  const c = sides(t);
  proseEdit(c);
  const before = [tree(c.oldDir), tree(c.newDir)];
  runDiff([c.oldDir, c.newDir]);
  runDiff([c.oldDir, c.newDir, "--json"]);
  assert.deepEqual([tree(c.oldDir), tree(c.newDir)], before);
});
