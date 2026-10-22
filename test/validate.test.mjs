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
