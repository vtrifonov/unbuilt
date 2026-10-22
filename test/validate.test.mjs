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
