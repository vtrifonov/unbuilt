import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli, runJson, makeTempDir, REPO_ROOT } from "./helpers.mjs";

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

test("CLI runs when launched through a symlinked directory path", (t) => {
  const dir = makeTempDir(t);
  const link = path.join(dir, "scr");
  fs.symlinkSync(path.join(REPO_ROOT, "scripts"), link, "dir");
  const missing = path.join(dir, "missing-instance");
  const r = spawnSync(process.execPath, [path.join(link, "validate.mjs"), missing], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /path does not exist/);
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
test("Markdown helpers accept CRLF line endings", () => {
  const crlf = "- **CORE-1** (MUST) Text.\r\n## One\r\n";
  const a = findAttempts(crlf, ["CORE"]);
  assert.equal(a.length, 1);
  assert.equal(a[0].exact.text, "Text.");
  assert.deepEqual(findScenarioSections(crlf), [{ title: "One", startLine: 2, endLine: 2 }]);
  const prose = blankCommentsAndFences(crlf);
  assert.equal(findAttempts(prose, ["CORE"]).length, 1);
  assert.equal(findScenarioSections(prose).length, 1);
  assert.equal(countLines(prose), countLines(crlf));
});

import zlib from "node:zlib";
import { extractImageText } from "../scripts/lib/image-meta.mjs";
import { makePng, makeJpeg, makeWebp } from "./helpers.mjs";

test("png metadata segments (R-VAL-43)", () => {
  const png = makePng({ text: [{ keyword: "Author", text: "/Users/alice/x" }], ztxt: [{ keyword: "Comment", text: "zipped note" }], itxt: [{ keyword: "XML:com.adobe.xmp", text: "xmp text", compressed: true }], exif: "Exif\0\0data" });
  const r = extractImageText(png);
  assert.equal(r.format, "png"); assert.equal(r.error, null);
  assert.ok(r.segments.some((s) => s.includes("/Users/alice/x")));
  assert.ok(r.segments.some((s) => s.includes("zipped note")));
  assert.ok(r.segments.some((s) => s.includes("xmp text")));
  assert.ok(r.segments.some((s) => s.includes("Exif")));
});
test("png with large IDAT and no text has no segments", () => {
  const r = extractImageText(makePng({ idatBytes: 300 * 1024 }));
  assert.equal(r.error, null); assert.deepEqual(r.segments, []);
});
test("png corrupt zTXt and truncated chunk are errors; earlier segments kept", () => {
  const a = extractImageText(makePng({ text: [{ keyword: "k", text: "first" }], ztxt: [{ keyword: "c", text: "x" }], corruptZtxt: true }));
  assert.match(a.error, /inflate/); assert.ok(a.segments.some((s) => s.includes("first")));
  const b = extractImageText(makePng({ truncate: true }));
  assert.match(b.error, /truncated/);
});
test("zTXt and compressed iTXt that inflate past 1 MiB are errors, not a memory blow-up (R-VAL-43)", { timeout: 5000 }, () => {
  const bomb = zlib.deflateSync(Buffer.alloc(2 * 1048576, 0x61));
  const t0 = Date.now();
  const z = extractImageText(makePng({ text: [{ keyword: "k", text: "first" }], ztxt: [{ keyword: "Comment", deflated: bomb }] }));
  const i = extractImageText(makePng({ itxt: [{ keyword: "XML:com.adobe.xmp", compressed: true, deflated: bomb }] }));
  assert.ok(Date.now() - t0 < 2000, "inflate cap must stop early");
  assert.equal(z.format, "png"); assert.notEqual(z.error, null);
  assert.ok(z.segments.some((s) => s.includes("first")));
  assert.equal(i.format, "png"); assert.notEqual(i.error, null);
  const ok = extractImageText(makePng({ ztxt: [{ keyword: "Comment", text: "zipped note" }] }));
  assert.equal(ok.error, null); assert.ok(ok.segments.some((s) => s.includes("zipped note")));
});
test("webp with an understated RIFF size is a truncated WebP chunk (R-VAL-43)", () => {
  for (const riffSize of [0, 3, 4]) {
    const r = extractImageText(makeWebp({ exif: "Exif\0\0/home/bob/pic", riffSize }));
    assert.equal(r.format, "webp"); assert.equal(r.error, "truncated WebP chunk", String(riffSize));
  }
});
test("jpeg APP1 and COM segments", () => {
  const xmp = "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>";
  const r = extractImageText(makeJpeg({ app1: [xmp, "Exif\0\0/home/bob/pic"], com: ["a comment"] }));
  assert.equal(r.format, "jpeg"); assert.equal(r.error, null);
  assert.equal(r.segments.length, 3);
  assert.ok(r.segments[0].includes("ns.adobe.com")); assert.ok(r.segments[1].includes("/home/bob/pic"));
});
test("webp EXIF and XMP chunks", () => {
  const r = extractImageText(makeWebp({ exif: "Exif\0\0ops@widgets-intranet.com", xmp: "<x/>" }));
  assert.equal(r.format, "webp"); assert.equal(r.error, null); assert.equal(r.segments.length, 2);
});
test("unknown magic is an error with format null", () => {
  const r = extractImageText(Buffer.from("GIF89a....", "latin1"));
  assert.equal(r.format, null); assert.match(r.error, /unrecognised/);
});
test("png text chunks after IDAT are still scanned (R-VAL-43, R-VAL-16)", () => {
  const r = extractImageText(makePng({ textAfterIdat: [{ keyword: "Author", text: "/Users/alice/late" }] }));
  assert.equal(r.format, "png"); assert.equal(r.error, null);
  assert.ok(r.segments.some((s) => s.includes("/Users/alice/late")));
});
test("malformed containers return an error, never throw or hang (R-VAL-43)", { timeout: 5000 }, () => {
  // JPEG APP1 whose 2-byte length (0xFFFF) runs past the end of the buffer.
  const a = extractImageText(makeJpeg({ raw: Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x41, 0x42]) }));
  assert.equal(a.format, "jpeg"); assert.match(a.error, /malformed JPEG/);
  // JPEG segment length 0 and length 1 (a length must be at least 2 because it includes itself).
  const b0 = extractImageText(makeJpeg({ raw: Buffer.from([0xff, 0xe1, 0x00, 0x00, 0xff, 0xd9]) }));
  assert.match(b0.error, /malformed JPEG/);
  const b1 = extractImageText(makeJpeg({ raw: Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xff, 0xd9]) }));
  assert.match(b1.error, /malformed JPEG/);
  // JPEG that is all FF after SOI: the fill-byte loop must stop at the end of the buffer.
  const c = extractImageText(makeJpeg({ raw: Buffer.alloc(64, 0xff) }));
  assert.match(c.error, /malformed JPEG/);
  // WebP chunk whose size runs past the RIFF end.
  const d = extractImageText(makeWebp({ raw: Buffer.concat([Buffer.from("EXIF", "latin1"), Buffer.from([0x00, 0x10, 0x00, 0x00]), Buffer.from("Exif\0\0", "latin1")]) }));
  assert.equal(d.format, "webp"); assert.match(d.error, /truncated WebP/);
  // PNG cut 5 bytes into a tEXt chunk, with no IDAT: truncation before IDAT is an error.
  const e = extractImageText(makePng({ text: [{ keyword: "Author", text: "cut" }], truncate: true }));
  assert.equal(e.format, "png"); assert.match(e.error, /truncated PNG/);
});

import { RULES, SUPPORTED_FORMAT_VERSION } from "../scripts/lib/rules.mjs";
import { copyMinimalValid, writeIn, readIn, FIXTURES } from "./helpers.mjs";

test("minimal-valid passes with zero findings and prints ok (R-TST-4, R-VAL-5)", () => {
  const j = runJson([path.join(FIXTURES, "minimal-valid"), "--json", "--today", "2026-10-22"]);
  assert.equal(j.code, 0); assert.deepEqual(j.result, { errors: [], warnings: [] });
  const h = runCli([path.join(FIXTURES, "minimal-valid"), "--today", "2026-10-22"]);
  assert.equal(h.stdout, "ok: minimal-valid passes unbuilt format 1\n");
});
test("internal error exits 2 (R-VAL-3)", () => {
  const r = runCli([path.join(FIXTURES, "minimal-valid")], { env: { UNBUILT_VALIDATE_THROW: "1" } });
  assert.equal(r.code, 2); assert.equal(r.stdout, ""); assert.match(r.stderr, /^internal error: /);
});
test("validator writes nothing (R-VAL-4)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  const snap = () => JSON.stringify([...walkInstance(dir).entries].map((e) => [e.path, e.size, fs.statSync(path.join(dir, e.path)).mtimeMs, fs.readFileSync(path.join(dir, e.path), "latin1")]));
  const before = snap(); runCli([dir, "--today", "2026-10-22"]); assert.equal(snap(), before);
});
test("unsupported version stops other rules (R-FMT-9)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  writeIn(dir, "unbuilt.yaml", fs.readFileSync(path.join(dir, "unbuilt.yaml"), "utf8").replace("unbuilt: 1", "unbuilt: 2"));
  fs.rmSync(path.join(dir, "constraints.md"));
  const j = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.equal(j.code, 1);
  assert.deepEqual(j.result.warnings, []);
  assert.deepEqual(j.result.errors, [{ rule: "yaml-fields", file: "unbuilt.yaml", line: 1, message: "format version 2 is not supported by this validator (supports 1); see CHANGELOG.md" }]);
});
test("SUPPORTED_FORMAT_VERSION is the integer 1 (R-VAL-9)", () => { assert.equal(SUPPORTED_FORMAT_VERSION, 1); assert.ok(Array.isArray(RULES)); });

import { buildContext, runRules } from "../scripts/validate.mjs";
import { finding } from "../scripts/lib/rules.mjs";

test("runRules skips needsMeta rules without unbuilt.yaml and masks every message (R-VAL-14, R-VAL-8)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  fs.rmSync(path.join(dir, "unbuilt.yaml"));
  const email = ["ops", "widgets-intranet.com"].join("@");
  RULES.push({ name: "stub-gated", needsMeta: true, fn: () => [finding("error", "stub-gated", "SPEC.md", 1, "gated rule ran")] });
  RULES.push({ name: "stub-free", needsMeta: false, fn: () => [finding("warning", "stub-free", "README.md", 1, `contact ${email} for access`)] });
  try {
    const findings = runRules(buildContext(dir, "2026-10-22"));
    const stubs = findings.filter((f) => f.rule.startsWith("stub-"));
    assert.deepEqual(stubs.map((f) => f.rule), ["stub-free"]);
    assert.ok(!stubs[0].message.includes(email), stubs[0].message);
    assert.match(stubs[0].message, /^contact op… for access$/);
  } finally {
    RULES.pop(); RULES.pop();
  }
});

import { runFixture, has } from "./helpers.mjs";

const ruleDirs = fs.readdirSync(FIXTURES).filter((n) => n !== "minimal-valid").sort();
for (const rule of ruleDirs) {
  test(`rule fixture: ${rule}`, (t) => {
    const { expect, code, result } = runFixture(t, rule);
    assert.equal(expect.rule, rule);
    assert.ok(has(result, rule, expect.level, expect.file), JSON.stringify(result));
    assert.equal(code, expect.level === "error" ? 1 : 0);
  });
}

test("readme.md does not satisfy README.md; a directory named README.md does not either (R-VAL-12)", (t) => {
  const a = runFixture(t, "required-files", { mutate: (d) => { fs.rmSync(path.join(d, "README.md")); fs.writeFileSync(path.join(d, "readme.md"), "# x"); } });
  assert.ok(has(a.result, "required-files", "error", "README.md"));
  const b = runFixture(t, "required-files", { mutate: (d) => { fs.rmSync(path.join(d, "README.md")); fs.mkdirSync(path.join(d, "README.md")); } });
  assert.ok(has(b.result, "required-files", "error", "README.md"));
});

test("empty instance directory yields five required-files errors and no crash", (t) => {
  const dir = makeTempDir(t);
  const j = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.equal(j.code, 1);
  assert.deepEqual(j.result.errors.map((f) => f.file).sort(), ["BUILD.md", "README.md", "SPEC.md", "constraints.md", "unbuilt.yaml"]);
});

test("rule gating on YAML failure: no needsMeta rule fires (R-VAL-14)", (t) => {
  const { result } = runFixture(t, "yaml-parse", { mutate: (d) => fs.appendFileSync(path.join(d, "README.md"), "\nContact alice@widgets-intranet.com.\n") });
  const fired = new Set([...result.errors, ...result.warnings].map((f) => f.rule));
  assert.ok(fired.has("yaml-parse"));
  const gated = RULES.filter((r) => r.needsMeta).map((r) => r.name);
  assert.ok(gated.includes("module-files"));
  for (const name of gated) assert.ok(!fired.has(name), `${name} ran although unbuilt.yaml failed to parse`);
});

test("yaml-fields warns on unknown keys and masks values (R-YML-4, R-VAL-8)", (t) => {
  const a = runFixture(t, "yaml-fields", { mutate: (d) => fs.appendFileSync(path.join(d, "unbuilt.yaml"), "colour: red\n") });
  assert.ok(has(a.result, "yaml-fields", "warning", "unbuilt.yaml"));
  assert.ok(a.result.warnings.some((f) => f.message === "unknown key colour is ignored (FORMAT.md §3)"));
  const b = runFixture(t, "yaml-fields", { mutate: (d) => writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("name: minimal-valid", "name: alice@widgets-intranet.com")) });
  const msgs = b.result.errors.filter((f) => f.rule === "yaml-fields").map((f) => f.message);
  assert.ok(msgs.length > 0 && msgs.every((m) => !m.includes("alice@widgets-intranet.com")));
});
test("quoted unbuilt version is a yaml-fields error, not the version short-circuit (spec 13)", (t) => {
  const { result } = runFixture(t, "yaml-fields", { mutate: (d) => writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("unbuilt: 1", 'unbuilt: "1"')) });
  assert.ok(result.errors.some((f) => f.rule === "yaml-fields" && f.message.includes("integer 1")));
});
test("reference_impl must agree with origin (R-YML-3)", (t) => {
  const { result } = runFixture(t, "yaml-fields", { mutate: (d) => writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("origin: extracted-from-private-implementation", "origin: designed-not-built")) });
  assert.ok(result.errors.some((f) => f.rule === "yaml-fields" && f.message.includes("literal none")));
});
test("module-paths: undeclared directory is a warning; trailing slash accepted (R-YML-6, R-YML-7)", (t) => {
  const a = runFixture(t, "module-paths", { mutate: (d) => fs.mkdirSync(path.join(d, "modules/extra")) });
  assert.ok(has(a.result, "module-paths", "warning", "modules/extra"));
  const dir = makeTempDir(t); copyMinimalValid(dir);
  writeIn(dir, "unbuilt.yaml", readIn(dir, "unbuilt.yaml").replace("path: modules/core", "path: modules/core/"));
  const b = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(b.result.errors, []);
});
// Mutates minimal-valid's unbuilt.yaml (clean baseline, no fixture overlay) and runs the CLI.
const mutYaml = (t, fn) => { const d = makeTempDir(t); copyMinimalValid(d); writeIn(d, "unbuilt.yaml", fn(readIn(d, "unbuilt.yaml"))); return runJson([d, "--json", "--today", "2026-10-22"]).result; };
const SECOND_MODULE = (p) => `  - id: PICK\n    path: ${p}\n    maturity: shipped\n`;
test("yaml-enums, module-ids and module-paths branches (R-YML-2, R-YML-5, R-YML-6, R-YML-15)", (t) => {
  const cases = [
    ["id fails ^[A-Z]{2,8}$", "module-ids", (y) => y.replace("id: CORE", "id: C0RE")],
    ["id is INV", "module-ids", (y) => y.replace("id: CORE", "id: INV")],
    ["path not under modules/", "module-paths", (y) => y.replace("path: modules/core", "path: core")],
    ["path contains ..", "module-paths", (y) => y.replace("path: modules/core", "path: modules/../modules/core")],
    ["two modules share a path", "module-paths", (y) => y.replace("substitutions:", SECOND_MODULE("modules/core") + "substitutions:")],
    ["modules/core and modules/core/ collide", "module-paths", (y) => y.replace("substitutions:", SECOND_MODULE("modules/core/") + "substitutions:")],
    ["public_hosts entry listed twice", "yaml-fields", (y) => y + "public_hosts:\n  - docs.example-public.org\n  - docs.example-public.org\n"],
    ["origin enum", "yaml-enums", (y) => y.replace("origin: extracted-from-private-implementation", "origin: found-on-a-disk")],
    ["original_effort enum", "yaml-enums", (y) => y + "original_effort: XXL\n"],
    ["interview enum", "yaml-enums", (y) => y.replace("interview: author", "interview: nobody")],
  ];
  for (const [name, rule, fn] of cases) {
    const result = mutYaml(t, fn);
    assert.ok(has(result, rule, "error", "unbuilt.yaml"), `${name}: ${JSON.stringify(result.errors)}`);
  }
  const twice = mutYaml(t, (y) => y + "public_hosts:\n  - docs.example-public.org\n  - docs.example-public.org\n");
  assert.ok(twice.errors.some((f) => f.rule === "yaml-fields" && f.message.includes("is listed twice")));
});
test("duplicate module path is reported once, at the second module (R-YML-6, spec 13)", (t) => {
  for (const p of ["modules/core", "modules/core/"]) {
    const result = mutYaml(t, (y) => y.replace("substitutions:", SECOND_MODULE(p) + "substitutions:"));
    const dup = result.errors.filter((f) => f.rule === "module-paths" && f.message.includes("is used by two modules"));
    assert.equal(dup.length, 1, p);
    assert.ok(!result.errors.some((f) => f.rule === "module-paths" && f.message.includes("is not a directory")), p);
  }
});

test("id attempts (R-VAL-22, rules 8 and 10)", (t) => {
  const spec = (lines) => (d) => writeIn(d, "modules/core/SPEC.md", "# Core\n\n" + lines.join("\n") + "\n");
  const star = runFixture(t, "id-format", { mutate: spec(["* **CORE-1** (MUST) star.", "- **CORE-2** (SHOULD) ok."]) });
  assert.ok(star.result.errors.some((f) => f.rule === "id-format" && f.line === 3 && f.message.includes("declarations are top-level")));
  const indented = runFixture(t, "id-format", { mutate: spec(["  - **CORE-1** (MUST) indented.", "- **CORE-2** (SHOULD) ok."]) });
  assert.ok(indented.result.errors.some((f) => f.rule === "id-format" && f.message.includes("declarations are top-level")));
  const grey = runFixture(t, "id-format", { mutate: spec(["- **CORE-1** (MUST) A note is saved when the user presses the save key.", "- **CORE-2** (SHOULD) ok.", "- **CORE-4** (MUST) Show retired clips in grey."]) });
  assert.ok(!grey.result.errors.some((f) => f.rule === "id-retired-form"));
  for (const bad of ["- **core-1** (MUST) lower.", "- **PICK-1** (MUST) other module.", "- **CORE-01** (MUST) zero.", "- **CORE-1** (must) lower modality."]) {
    const r = runFixture(t, "id-format", { mutate: spec([bad, "- **CORE-2** (SHOULD) ok."]) });
    assert.ok(r.result.errors.some((f) => f.rule === "id-format" && f.line === 3), bad);
  }
  const glossary = runFixture(t, "id-format", { mutate: (d) => { spec(["- **CORE-1** (MUST) A note is saved when the user presses the save key.", "- **CORE-2** (SHOULD) ok."])(d); writeIn(d, "SPEC.md", readIn(d, "SPEC.md").replace("- **Note**: a short piece of text the user typed.", "- **UTF-8**: the text encoding of captured clips.")); } });
  assert.ok(!glossary.result.errors.some((f) => f.rule === "id-format"));
});
test("retired forms and retired citations (rule 10)", (t) => {
  const a = runFixture(t, "id-retired-form", { mutate: (d) => writeIn(d, "modules/core/SPEC.md", "# Core\n\n- **CORE-1** (MUST) A note is saved when the user presses the save key.\n- **CORE-2** (MUST) retired\n") });
  assert.ok(has(a.result, "id-retired-form", "error", "modules/core/SPEC.md"));
  assert.ok(!a.result.errors.some((f) => f.rule === "id-format"));
  const b = runFixture(t, "id-retired-form", { mutate: (d) => writeIn(d, "modules/core/SPEC.md", "# Core\n\n- **CORE-1** (MUST) A note is saved when the user presses the save key.\n- **CORE-2** retired: superseded\n") });
  assert.ok(b.result.errors.some((f) => f.rule === "id-retired-form" && f.file === "modules/core/scenarios.md" && f.message.includes("must not be cited")));
});
test("id-unique names the first declaration (rule 9)", (t) => {
  const { result } = runFixture(t, "id-unique");
  assert.ok(result.errors.some((f) => f.rule === "id-unique" && f.line === 5 && f.message.includes("modules/core/SPEC.md:3")));
});

test("scenario coverage edge cases (rules 11–13)", (t) => {
  const inv = runFixture(t, "must-has-scenario", { mutate: (d) => writeIn(d, "modules/core/scenarios.md", readIn(d, "modules/core/scenarios.md").replace("Covers: INV-1", "Covers: CORE-1")) });
  assert.ok(inv.result.errors.some((f) => f.rule === "must-has-scenario" && f.file === "SPEC.md" && f.line === 13));
  const utf = runFixture(t, "scenario-cites-id", { mutate: (d) => writeIn(d, "modules/core/scenarios.md", readIn(d, "modules/core/scenarios.md").replace("Covers: CORE-9", "Covers: UTF-8")) });
  assert.ok(utf.result.errors.some((f) => f.rule === "scenario-cites-id" && f.line === 3 && f.message.includes("cites no declared")));
  assert.ok(!utf.result.errors.some((f) => f.message.includes("UTF-8 is cited")));
  const empty = runFixture(t, "should-has-scenario", { mutate: (d) => writeIn(d, "modules/core/scenarios.md", "# Scenarios\n\nnothing here\n") });
  assert.ok(has(empty.result, "scenario-cites-id", "warning", "modules/core/scenarios.md"));
  const expected = runFixture(t, "should-has-scenario");
  assert.ok(expected.result.warnings.some((f) => f.rule === "should-has-scenario" && f.line === 4 && f.message === "CORE-2 is a SHOULD but no scenario cites it (FORMAT.md §5)"));
});

test("retired declarations: prefix check, bullet message, shared-dir dedupe (fix 1)", (t) => {
  const spec = (lines) => (d) => writeIn(d, "modules/core/SPEC.md", "# Core\n\n" + lines.join("\n") + "\n");
  const head = "- **CORE-1** (MUST) A note is saved when the user presses the save key.";
  const wrong = runFixture(t, "id-format", { mutate: spec([head, "- **PICK-7** retired: moved elsewhere."]) });
  assert.ok(wrong.result.errors.some((f) => f.rule === "id-format" && f.line === 4 && f.message.includes("PICK-7 is declared in")));
  const right = runFixture(t, "id-format", { mutate: spec([head, "- **CORE-2** retired: reason"]) });
  assert.ok(!right.result.errors.some((f) => f.rule === "id-format"));
  const shaped = runFixture(t, "id-retired-form", { mutate: spec([head, "* **CORE-8** retired: reason", "  - **CORE-9** retired: reason"]) });
  for (const line of [4, 5]) assert.ok(shaped.result.errors.some((f) => f.rule === "id-retired-form" && f.line === line && f.message.includes("declarations are top-level")), String(line));
  const d = makeTempDir(t); copyMinimalValid(d);
  writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("substitutions:", SECOND_MODULE("modules/core") + "substitutions:"));
  fs.rmSync(path.join(d, "modules/core/problem.md"));
  const dup = runJson([d, "--json", "--today", "2026-10-22"]).result.errors.filter((f) => f.rule === "module-files");
  assert.equal(dup.length, 1);
});

test("substitution warnings and the empty-list case (rules 14–15, spec 13)", (t) => {
  const unlisted = runFixture(t, "substitution-files", { mutate: (d) => { writeIn(d, "substitutions/storage.md", "# storage\n"); writeIn(d, "substitutions/cache.md", "# cache\n"); } });
  assert.ok(has(unlisted.result, "substitution-files", "warning", "substitutions/cache.md"));
  assert.deepEqual(unlisted.result.errors, []);
  const dir = makeTempDir(t); copyMinimalValid(dir);
  writeIn(dir, "unbuilt.yaml", readIn(dir, "unbuilt.yaml").replace("substitutions:\n  - storage\n", ""));
  const r = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(r.result.errors, []);
  assert.ok(has(r.result, "substitution-files", "warning", "substitutions/storage.md"));
  assert.ok(!r.result.warnings.some((f) => f.rule === "substitution-matrix"));
});
test("matrix row and cell errors (rule 15)", (t) => {
  const rows = runFixture(t, "substitution-matrix", { mutate: (d) => writeIn(d, "substitutions/README.md", "# S\n\n| Module | storage |\n|---|---|\n| PICK | yes |\n") });
  const msgs = rows.result.errors.filter((f) => f.rule === "substitution-matrix").map((f) => f.message);
  assert.ok(msgs.some((m) => m.includes('row "PICK"')) && msgs.some((m) => m.includes("missing row CORE")) && msgs.some((m) => m.includes('cell "yes"')));
});

test("evidence-dates: expired warning, bad date, equal date, name shape (rule 16)", (t) => {
  const ev = "evidence/2026-10-01-storage-api.md";
  const expired = runFixture(t, "evidence-dates", { mutate: (d) => writeIn(d, ev, "# Storage API\n\nChecked: 2025-01-10\nExpires: 2025-07-10\n") });
  assert.ok(expired.result.warnings.some((f) => f.rule === "evidence-dates" && f.file === ev && f.line === 4 && f.message === "expired on 2025-07-10; re-check before relying on it (FORMAT.md §4)"));
  assert.deepEqual(expired.result.errors, []);
  const bad = runFixture(t, "evidence-dates", { mutate: (d) => writeIn(d, ev, "Checked: 2026-02-30\nExpires: 2027-01-01\n") });
  assert.ok(bad.result.errors.some((f) => f.rule === "evidence-dates" && f.line === 1 && f.message.includes("not a calendar date")));
  const equal = runFixture(t, "evidence-dates", { mutate: (d) => writeIn(d, ev, "Expires: 2026-10-22\nChecked: 2026-01-01\n") });
  assert.ok(![...equal.result.errors, ...equal.result.warnings].some((f) => f.rule === "evidence-dates"));
  const name = runFixture(t, "evidence-dates", { mutate: (d) => { writeIn(d, ev, "Checked: 2026-01-01\nExpires: 2027-01-01\n"); writeIn(d, "evidence/notes.md", "Checked: 2026-01-01\nExpires: 2027-01-01\n"); } });
  assert.ok(has(name.result, "evidence-dates", "error", "evidence/notes.md"));
  const before = runFixture(t, "evidence-dates", { mutate: (d) => writeIn(d, ev, "# Storage API\n\nChecked: 2026-10-01\nExpires: 2026-09-01\n") });
  assert.ok(before.result.errors.some((f) => f.rule === "evidence-dates" && f.file === ev && f.line === 4 && f.message.includes("is before Checked")));
});

test("substitution-files and matrix branches (rules 14-15)", (t) => {
  const dup = makeTempDir(t); copyMinimalValid(dup);
  writeIn(dup, "unbuilt.yaml", readIn(dup, "unbuilt.yaml").replace("substitutions:\n  - storage\n", "substitutions:\n  - storage\n  - storage\n  - Bad_Name\n"));
  const dr = runJson([dup, "--json", "--today", "2026-10-22"]).result.errors.filter((f) => f.rule === "substitution-files");
  assert.ok(dr.some((f) => f.file === "unbuilt.yaml" && f.message === "substitution storage is listed twice (FORMAT.md §4)"));
  assert.ok(dr.some((f) => f.file === "unbuilt.yaml" && f.message === 'substitution name "Bad_Name" must be kebab-case (FORMAT.md §4)'));
  const noReadme = makeTempDir(t); copyMinimalValid(noReadme);
  fs.rmSync(path.join(noReadme, "substitutions/README.md"));
  const nr = runJson([noReadme, "--json", "--today", "2026-10-22"]).result;
  assert.ok(nr.errors.some((f) => f.rule === "substitution-files" && f.file === "substitutions/README.md" && f.message.includes("is required when substitutions is non-empty")));
  const col = runFixture(t, "substitution-matrix", { mutate: (d) => writeIn(d, "substitutions/README.md", "# S\n\n| Module |\n|---|\n| CORE |\n") });
  assert.ok(col.result.errors.some((f) => f.rule === "substitution-matrix" && f.line === 3 && f.message === "matrix is missing column storage (FORMAT.md §4)"));
  const none = runFixture(t, "substitution-matrix", { mutate: (d) => writeIn(d, "substitutions/README.md", "# S\n\nno table here\n") });
  assert.ok(none.result.errors.some((f) => f.rule === "substitution-matrix" && f.message.startsWith("no table whose header starts with Module")));
});

const leakRules = (r) => [...r.errors, ...r.warnings].filter((f) => f.rule.startsWith("leak-"));
test("leak messages mask the match (R-VAL-8)", (t) => {
  for (const rule of ["leak-email", "leak-ipv4", "leak-hostname", "leak-home-path", "leak-secret"]) {
    const { expect, result } = runFixture(t, rule);
    const f = result.errors.find((x) => x.rule === rule);
    assert.ok(f && f.line === 11 && f.file === expect.file, rule);
    for (const full of ["alice@widgets-intranet.com", "10.20.30.40", "build01.widgets-intranet.com", "/Users/alice", "AKIAIOSFODNN7EXAMPLE"]) assert.ok(!f.message.includes(full), rule);
    assert.match(f.message, /…/);
  }
});
test("leak-ipv4 forwards the ipv6 pattern (R-TST-7)", (t) => {
  const { result } = runFixture(t, "leak-ipv4", { mutate: (d) => fs.appendFileSync(path.join(d, "README.md"), "Peer fd12:3456:789a::1 here.\nHardware aa:bb:cc:dd:ee:ff here.\n") });
  assert.ok(result.errors.some((f) => f.rule === "leak-ipv4" && f.message.startsWith("IPv6 address fd…")));
  assert.ok(result.errors.some((f) => f.rule === "leak-ipv4" && f.message.startsWith("MAC address aa…")));
});
test("reference_impl host is exact; public_hosts entries are exact (R-VAL-25, R-YML-15, R-VAL-27)", (t) => {
  const pub = (d, extra = "") => writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("origin: extracted-from-private-implementation", "origin: extracted-from-public-implementation").replace("reference_impl: private", "reference_impl: https://tool.example-public.org") + extra);
  const a = runFixture(t, "leak-email", { mutate: (d) => { pub(d); writeIn(d, "README.md", "# minimal-valid\n\nSee tool.example-public.org and ci.tool.example-public.org.\n"); } });
  const hosts = a.result.errors.filter((f) => f.rule === "leak-hostname").map((f) => f.message);
  assert.equal(hosts.length, 1); assert.ok(hosts[0].startsWith("hostname ci…"));
  const b = runFixture(t, "leak-email", { mutate: (d) => { pub(d, "public_hosts:\n  - docs.example-public.org\n  - 1.1.1.1\n"); writeIn(d, "README.md", "# minimal-valid\n\nSee docs.example-public.org and 1.1.1.1, not 1.1.1.2 or api.docs.example-public.org.\n"); } });
  assert.deepEqual(leakRules(b.result).map((f) => f.rule).sort(), ["leak-hostname", "leak-ipv4"]);
  const c = runFixture(t, "leak-email", { mutate: (d) => pub(d, "public_hosts:\n  - Docs.Example\n") });
  assert.ok(c.result.errors.some((f) => f.rule === "yaml-fields" && f.message.includes("public_hosts entry")));
  const broken = runFixture(t, "leak-email", { mutate: (d) => { pub(d, "public_hosts:\n  - docs.example-public.org\nplatforms: [x]\n"); writeIn(d, "README.md", "# minimal-valid\n\nSee docs.example-public.org.\n"); } });
  assert.ok(broken.result.errors.some((f) => f.rule === "leak-hostname"));
});
test("walk and parse interplay for leaks (R-VAL-12, R-VAL-16, R-VAL-28)", (t) => {
  const git = runFixture(t, "leak-email", { mutate: (d) => { writeIn(d, "README.md", "# minimal-valid\n\nclean\n"); fs.mkdirSync(path.join(d, ".git")); writeIn(d, ".git/x.md", "ops@widgets-intranet.com"); } });
  assert.deepEqual(leakRules(git.result), []);
  const hidden = runFixture(t, "leak-email", { mutate: (d) => writeIn(d, "README.md", "# minimal-valid\n\n<!-- ops@widgets-intranet.com -->\n\n```\n10.20.30.40\n```\n") });
  assert.deepEqual(leakRules(hidden.result).map((f) => [f.rule, f.line]), [["leak-email", 3], ["leak-ipv4", 6]]);
  const dbl = runFixture(t, "leak-email", { mutate: (d) => writeIn(d, "README.md", "# minimal-valid\n\nalice@build01.widgets-intranet.com\nhttps://build01.widgets-intranet.com/x\n") });
  assert.deepEqual(leakRules(dbl.result).map((f) => f.rule), ["leak-email", "leak-hostname"]);
});
test("leak rules filter the hits buildContext scanned once; they never rescan (security review finding 1)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  writeIn(dir, "notes.md", "Ask alice@widgets-intranet.com about 10.20.30.40 today.\n");
  const ctx = buildContext(dir, "2026-10-22");
  assert.deepEqual(ctx.leakHits.map((h) => [h.file, h.line, h.pattern]), [["notes.md", 1, "email"], ["notes.md", 1, "ipv4"]]);
  assert.deepEqual(runRules(ctx).filter((f) => f.rule.startsWith("leak-")).map((f) => f.rule).sort(), ["leak-email", "leak-ipv4"]);
  ctx.leakHits = [];
  assert.deepEqual(runRules(ctx).filter((f) => f.rule.startsWith("leak-")), []);
});
test("scenario citations are linear in the number of sections: 20,000 headings build under 2 s (security review finding 3)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  fs.appendFileSync(path.join(dir, "modules/core/scenarios.md"), "\n" + "## s\n".repeat(20000));
  const t0 = performance.now();
  const ctx = buildContext(dir, "2026-10-22");
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
  assert.ok(ctx.scenarios.length > 20000);
});
test("rule gating on YAML failure keeps the leak rules running (R-VAL-14)", (t) => {
  const { result } = runFixture(t, "yaml-parse", { mutate: (d) => fs.appendFileSync(path.join(d, "README.md"), "\nContact alice@widgets-intranet.com.\n") });
  const rules = new Set([...result.errors, ...result.warnings].map((f) => f.rule));
  assert.deepEqual([...rules].sort(), ["leak-email", "yaml-parse"]);
});
test("raster metadata is scanned, pixels are not (R-VAL-13, R-VAL-16, R-VAL-43)", (t) => {
  const clean = (d) => writeIn(d, "README.md", "# minimal-valid\n\nclean\n");
  const a = runFixture(t, "leak-email", { mutate: (d) => { clean(d); fs.writeFileSync(path.join(d, "design/shot.png"), makePng({ text: [{ keyword: "Author", text: "/Users/alice/x" }] })); } });
  const l = leakRules(a.result); assert.equal(l.length, 1); assert.equal(l[0].rule, "leak-home-path"); assert.equal(l[0].file, "design/shot.png"); assert.equal("line" in l[0], false);
  const b = runFixture(t, "leak-email", { mutate: (d) => { clean(d); fs.writeFileSync(path.join(d, "design/big.png"), makePng({ idatBytes: 300 * 1024 })); } });
  assert.deepEqual(leakRules(b.result), []);
  const c = runFixture(t, "leak-email", { mutate: (d) => { clean(d); fs.writeFileSync(path.join(d, "design/shot.jpg"), makeJpeg({ app1: ["http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>"] })); } });
  assert.deepEqual(leakRules(c.result), []);
  assert.deepEqual(c.result.errors.filter((f) => f.rule === "file-types"), []);
});

test("budget edge cases (rules 24–26, R-VAL-33, R-VAL-42)", (t) => {
  const gif = runFixture(t, "budget-image", { mutate: (d) => fs.writeFileSync(path.join(d, "design/screen.gif"), "GIF89a") });
  assert.ok(has(gif.result, "budget-image", "error", "design/screen.gif"));
  assert.ok(!gif.result.errors.some((f) => f.rule === "file-types" && f.file === "design/screen.gif"));
  const big = runFixture(t, "budget-file-lines", { mutate: (d) => { fs.writeFileSync(path.join(d, "big.md"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)); fs.writeFileSync(path.join(d, "notes.txt"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)); } });
  assert.ok(big.result.errors.some((f) => f.rule === "budget-file-lines" && f.file === "big.md" && f.message.includes("too large to scan")));
  assert.ok(big.result.errors.some((f) => f.rule === "budget-file-lines" && f.file === "notes.txt" && f.message.includes("too large to scan")));
  const ok = runFixture(t, "budget-file-lines", { mutate: (d) => fs.writeFileSync(path.join(d, "notes.md"), "w\n".repeat(1500)) });
  assert.ok(!ok.result.errors.some((f) => f.rule === "budget-file-lines"));
});

test("budgets accept exactly the limit (R-FMT-37: at most N)", (t) => {
  const twelve = runFixture(t, "budget-module-count", { mutate: (d) => {
    writeIn(d, "unbuilt.yaml", readIn(d, "unbuilt.yaml").replace("  - id: AL\n    path: modules/al\n    maturity: shipped\n", ""));
    fs.rmSync(path.join(d, "modules/al"), { recursive: true, force: true });
    writeIn(d, "substitutions/README.md", readIn(d, "substitutions/README.md").replace("| AL | - |\n", ""));
  } });
  assert.deepEqual([...twelve.result.errors, ...twelve.result.warnings], []);
  const png = runFixture(t, "budget-image", { mutate: (d) => fs.writeFileSync(path.join(d, "design/big.png"), makePng({ totalBytes: 2097152 })) });
  assert.equal(fs.statSync(path.join(png.dir, "design/big.png")).size, 2097152);
  assert.ok(!png.result.errors.some((f) => f.rule === "budget-image"));
  const wordsTo = (total) => (d) => {
    fs.rmSync(path.join(d, "notes.md"), { force: true });
    let base = 0;
    for (const rel of fs.readdirSync(d, { recursive: true })) if (rel.endsWith(".md")) base += countWords(readIn(d, rel));
    const rows = [];
    for (let left = total - base; left > 0; left -= 200) rows.push(Array(Math.min(200, left)).fill("w").join(" "));
    writeIn(d, "notes.md", rows.join("\n") + "\n");
  };
  const at = runFixture(t, "budget-total-words", { mutate: wordsTo(60000) });
  assert.ok(!at.result.errors.some((f) => f.rule === "budget-total-words"));
  const over = runFixture(t, "budget-total-words", { mutate: wordsTo(60001) });
  assert.ok(over.result.errors.some((f) => f.rule === "budget-total-words" && f.message.includes("60001 words")));
});

test("each generated budget fixture fires only its own rule (plan decision 9)", (t) => {
  for (const rule of ["budget-file-lines", "budget-total-words", "budget-image", "budget-module-count", "file-types"]) {
    const { result } = runFixture(t, rule);
    assert.deepEqual([...result.errors, ...result.warnings].map((f) => f.rule), [rule], rule);
  }
});

import os from "node:os";
import { execFileSync } from "node:child_process";
const isWin = process.platform === "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const ft = (r, file) => r.errors.filter((f) => f.rule === "file-types" && f.file === file);
// Probe once: can this platform create a symlink? (R-TST-11: skip with a reason, never pass silently)
const canSymlink = (() => {
  let d = null;
  try { d = fs.mkdtempSync(path.join(os.tmpdir(), "unbuilt-probe-")); fs.writeFileSync(path.join(d, "a"), "x"); fs.symlinkSync("a", path.join(d, "b")); return true; } catch { return false; } finally { if (d) fs.rmSync(d, { recursive: true, force: true }); }
})();
test("file-types: symlinked required file is both missing and a file-types finding (R-VAL-42, spec 12.1)", { skip: canSymlink ? false : "platform refuses symlinkSync" }, (t) => {
  const link = runFixture(t, "file-types", { mutate: (d) => { fs.rmSync(path.join(d, "constraints.md")); fs.symlinkSync("README.md", path.join(d, "constraints.md")); } });
  assert.equal(ft(link.result, "constraints.md").length, 1); assert.ok(has(link.result, "required-files", "error", "constraints.md"));
  assert.match(ft(link.result, "constraints.md")[0].message, /symbolic link/);
});
test("file-types sub-cases (R-VAL-42, R-VAL-43)", (t) => {
  const nul = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "odd.md"), Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00])) });
  assert.equal(ft(nul.result, "odd.md").length, 1);
  const nm = runFixture(t, "file-types", { mutate: (d) => { fs.mkdirSync(path.join(d, "node_modules/x"), { recursive: true }); writeIn(d, "node_modules/x/index.js", "1"); } });
  assert.equal(ft(nm.result, "node_modules").length, 1);
  const renamed = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/shot.png"), makeJpeg({ app1: ["Exif\0\0/Users/alice/pic"] })) });
  assert.equal(ft(renamed.result, "design/shot.png").length, 1); assert.ok(renamed.result.errors.some((f) => f.rule === "leak-home-path" && f.file === "design/shot.png"));
  const corrupt = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/shot.png"), makePng({ ztxt: [{ keyword: "c", text: "x" }], corruptZtxt: true })) });
  assert.equal(ft(corrupt.result, "design/shot.png").length, 1);
  const upper = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/Shot.PNG"), makePng({})) });
  assert.equal(ft(upper.result, "design/Shot.PNG").length, 0);
  // A malformed JPEG (APP1 length past the end) is a file-types finding, not an internal error (Task 14 risk, R-VAL-43).
  const bad = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/bad.jpg"), makeJpeg({ raw: Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x41]) })) });
  assert.equal(bad.code, 1);
  assert.equal(ft(bad.result, "design/bad.jpg").length, 1); assert.match(ft(bad.result, "design/bad.jpg")[0].message, /malformed JPEG segment/);
  // An .svg is an allowed image only when it is text (spec amendment 5): a UTF-16 SVG cannot be scanned for leaks.
  const svg16 = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/x.svg"), Buffer.from("<svg>/Users/alice/x</svg>", "utf16le")) });
  assert.equal(ft(svg16.result, "design/x.svg").length, 1); assert.match(ft(svg16.result, "design/x.svg")[0].message, /not a text file or an allowed image \(FORMAT\.md §7\)$/);
  const svg8 = runFixture(t, "file-types", { mutate: (d) => fs.writeFileSync(path.join(d, "design/ok.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>\n') });
  assert.equal(ft(svg8.result, "design/ok.svg").length, 0);
});
test("file-types FIFO", { skip: isWin ? "no FIFOs on Windows" : false }, (t) => {
  const r = runFixture(t, "file-types", { mutate: (d) => execFileSync("mkfifo", [path.join(d, "pipe")]) });
  assert.ok(r.result.errors.some((f) => f.rule === "file-types" && f.file === "pipe" && f.message.includes("FIFO")));
});
test("file-types unreadable file", { skip: isWin ? "no POSIX modes on Windows" : isRoot ? "root can read mode-000 files" : false }, (t) => {
  const r = runFixture(t, "file-types", { mutate: (d) => { writeIn(d, "secret.md", "x"); fs.chmodSync(path.join(d, "secret.md"), 0); } });
  assert.ok(r.result.errors.some((f) => f.rule === "file-types" && f.file === "secret.md" && f.message.includes("cannot be read")));
});

import * as rulesModule from "../scripts/lib/rules.mjs";
const RULE_NAMES = ["required-files", "module-files", "yaml-parse", "yaml-fields", "yaml-enums", "module-ids", "module-paths", "id-format", "id-unique", "id-retired-form", "scenario-cites-id", "must-has-scenario", "should-has-scenario", "substitution-files", "substitution-matrix", "evidence-dates", "redaction-required", "design-required", "leak-email", "leak-ipv4", "leak-hostname", "leak-home-path", "leak-secret", "budget-file-lines", "budget-total-words", "budget-image", "budget-module-count", "file-types"];
test("RULES names and order (R-VAL-20)", () => {
  assert.deepEqual(RULES.map((r) => r.name), RULE_NAMES);
  for (const r of RULES) assert.equal(typeof r.fn, "function");
});
test("rules.mjs exports one camelCase function per rule, the same one RULES holds (R-VAL-9)", () => {
  const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  for (const r of RULES) assert.equal(rulesModule[camel(r.name)], r.fn, `${camel(r.name)} is not exported as RULES' ${r.name} function`);
});
test("every rule has a fixture directory and nothing else is there (R-TST-8)", () => {
  assert.deepEqual(fs.readdirSync(FIXTURES).filter((n) => n !== "minimal-valid").sort(), [...RULE_NAMES].sort());
});
const mixed = (d) => {
  fs.rmSync(path.join(d, "constraints.md"));
  fs.appendFileSync(path.join(d, "README.md"), "\nContact alice@widgets-intranet.com.\n");
  fs.appendFileSync(path.join(d, "unbuilt.yaml"), "colour: red\n");
  writeIn(d, "evidence/2025-01-10-api.md", "# Old API\nChecked: 2025-01-10\nExpires: 2025-07-10\n");
  writeIn(d, "modules/core/scenarios.md", readIn(d, "modules/core/scenarios.md").replace("Covers: CORE-2", "Covers: CORE-1"));
};
const GOLDEN = [
  "error    leak-email         README.md:11  email address al… found; replace it with a role word (FORMAT.md §7)",
  "error    required-files     constraints.md  required file constraints.md is missing (FORMAT.md §3)",
  "warning  evidence-dates     evidence/2025-01-10-api.md:3  expired on 2025-07-10; re-check before relying on it (FORMAT.md §4)",
  "warning  should-has-scenario  modules/core/SPEC.md:4  CORE-2 is a SHOULD but no scenario cites it (FORMAT.md §5)",
  "warning  yaml-fields        unbuilt.yaml:17  unknown key colour is ignored (FORMAT.md §3)",
  "2 error(s), 3 warning(s)",
].join("\n") + "\n";
test("human output golden (R-VAL-5)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir); mixed(dir);
  const r = runCli([dir, "--today", "2026-10-22"]);
  assert.equal(r.code, 1); assert.equal(r.stdout, GOLDEN);
});
test("json sort order (R-VAL-6)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir); mixed(dir);
  const { result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(result.errors.map((f) => [f.rule, f.file, f.line]), [["leak-email", "README.md", 11], ["required-files", "constraints.md", undefined]]);
  assert.deepEqual(result.warnings.map((f) => f.rule), ["evidence-dates", "should-has-scenario", "yaml-fields"]);
  assert.equal("line" in result.errors[1], false);
});
test("warnings-only run prints counts, not ok (R-VAL-5)", (t) => {
  const r = runFixture(t, "should-has-scenario");
  const h = runCli([r.dir, "--today", "2026-10-22"]);
  assert.equal(h.code, 0); assert.match(h.stdout, /\n0 error\(s\), 1 warning\(s\)\n$/);
});
test("a finding without a line sorts before line findings in the same file (Review Focus 5)", (t) => {
  // notes.md: 1,502 lines (budget-file-lines, no line), a home path on line 1 and an email on line 2.
  // Line order (home path, then email) disagrees with rule-name order, so only a line sort passes.
  const dir = makeTempDir(t); copyMinimalValid(dir);
  writeIn(dir, "notes.md", "Path /Users/alice/x here.\nContact alice@widgets-intranet.com.\n" + "w\n".repeat(1500));
  const { result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  const notes = result.errors.filter((f) => f.file === "notes.md");
  assert.deepEqual(notes.map((f) => [f.rule, f.line]), [["budget-file-lines", undefined], ["leak-home-path", 1], ["leak-email", 2]]);
  assert.equal("line" in notes[0], false);
  const h = runCli([dir, "--today", "2026-10-22"]);
  const lines = h.stdout.split("\n").filter((l) => l.includes("notes.md"));
  assert.match(lines[0], /^error    budget-file-lines  notes.md  /);
  assert.match(lines[1], /^error    leak-home-path     notes.md:1  /);
  assert.match(lines[2], /^error    leak-email         notes.md:2  /);
});
test("findings on the same file and line sort by rule name (R-VAL-6)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  // Rule order and message order agree here (leak-email / "email…" before leak-home-path / "home…").
  writeIn(dir, "same.md", "Ask alice@widgets-intranet.com about /Users/alice/x today.\n");
  // Rule order (leak-hostname, leak-ipv4) disagrees with both message order ("IPv4…" < "hostname…") and RULES order (ipv4 first).
  writeIn(dir, "pair.md", "Reach 10.20.30.40 or build01.widgets-intranet.com today.\n");
  const { result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(result.errors.filter((f) => f.file === "same.md").map((f) => [f.rule, f.line]), [["leak-email", 1], ["leak-home-path", 1]]);
  assert.deepEqual(result.errors.filter((f) => f.file === "pair.md").map((f) => [f.rule, f.line]), [["leak-hostname", 1], ["leak-ipv4", 1]]);
});
