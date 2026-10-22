import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { extractImageText } from "../scripts/lib/image-meta.mjs";
import { buildContext } from "../scripts/validate.mjs";
import { copyMinimalValid, makePng, makeTempDir, runJson } from "./helpers.mjs";

const KIB = 1024;
const chunkOf = (bytes) => zlib.deflateSync(Buffer.alloc(bytes, 0x61));

test("inflated metadata is capped at 1 MiB per image, not per chunk (security review finding 2)", () => {
  const ztxt = [1, 2, 3].map((i) => ({ keyword: `c${i}`, deflated: chunkOf(400 * KIB) }));
  const r = extractImageText(makePng({ ztxt }));
  assert.equal(r.format, "png");
  assert.match(r.error ?? "", /metadata inflates past 1 MiB/);
  const kept = r.segments.reduce((n, s) => n + s.length, 0);
  assert.ok(kept <= 1048576 + 64, `kept ${kept} characters of inflated text`);
  const mixed = extractImageText(makePng({ ztxt: [{ keyword: "a", deflated: chunkOf(600 * KIB) }], itxt: [{ keyword: "XML:com.adobe.xmp", compressed: true, deflated: chunkOf(600 * KIB) }] }));
  assert.match(mixed.error ?? "", /metadata inflates past 1 MiB/);
  const two = extractImageText(makePng({ ztxt: [1, 2].map((i) => ({ keyword: `c${i}`, deflated: chunkOf(400 * KIB) })) }));
  assert.equal(two.error, null);
});

test("a PNG whose chunks inflate past 1 MiB in total is a file-types error (security review finding 2)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  const ztxt = [1, 2, 3].map((i) => ({ keyword: `c${i}`, deflated: chunkOf(400 * KIB) }));
  fs.writeFileSync(path.join(dir, "design/bomb.png"), makePng({ ztxt }));
  const { code, result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.equal(code, 1);
  assert.ok(result.errors.some((f) => f.rule === "file-types" && f.file === "design/bomb.png" && f.message.includes("image cannot be parsed")), JSON.stringify(result.errors));
});

const XMP = '<x:xmpmeta><rdf:Description stRef:filePath="/Users/alice/Designs/billing.psd" src="https://figma.widgets-intranet.com/file/1"/></x:xmpmeta>';
const xmpPng = () => makePng({ itxt: [{ keyword: "XML:com.adobe.xmp", text: XMP, compressed: true }] });
const svgWith = (href) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1" height="1">\n<image width="1" height="1" xlink:href="${href}"/>\n</svg>\n`;
const runWith = (t, files) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), body);
  return runJson([dir, "--json", "--today", "2026-10-22"]);
};
const pick = (result) => [...result.errors, ...result.warnings].map((f) => [f.rule, f.file, f.line]);

test("a raster embedded as a data: URI has its metadata scanned and reported at the containing file and line (amendment 7a)", (t) => {
  const svg = svgWith("data:image/png;base64," + xmpPng().toString("base64"));
  const { code, result } = runWith(t, { "design/mock.svg": svg });
  assert.equal(code, 1);
  assert.deepEqual(pick(result), [["leak-home-path", "design/mock.svg", 2], ["leak-hostname", "design/mock.svg", 2]]);
  const md = runWith(t, { "notes.md": "# Notes\n\nShot: ![x](data:image/jpeg;base64," + Buffer.from(makeJpegWithPath()).toString("base64") + ")\n" });
  assert.deepEqual(pick(md.result), [["leak-home-path", "notes.md", 3]]);
});

test("an embedded data: URI of any other image type is a file-types error (amendment 7a)", (t) => {
  const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1").toString("base64");
  const { code, result } = runWith(t, { "design/mock.svg": svgWith("data:image/gif;base64," + gif) });
  assert.equal(code, 1);
  assert.deepEqual(pick(result), [["file-types", "design/mock.svg", 2]]);
  assert.match(result.errors[0].message, /data:image\/gif/);
});

test("embedded raster edge cases: clean, broken, mislabelled, and prose mentions (amendment 7a)", (t) => {
  const clean = runWith(t, { "design/mock.svg": svgWith("data:image/png;base64," + makePng({}).toString("base64")) });
  assert.deepEqual(pick(clean.result), []);
  const broken = runWith(t, { "design/mock.svg": svgWith("data:image/png;base64," + makePng({ truncate: true, text: [{ keyword: "a", text: "b" }] }).toString("base64")) });
  assert.deepEqual(pick(broken.result), [["file-types", "design/mock.svg", 2]]);
  assert.match(broken.result.errors[0].message, /embedded image cannot be parsed for metadata scanning \(truncated PNG chunk\)/);
  const mislabelled = runWith(t, { "design/mock.svg": svgWith("data:image/webp;base64," + makePng({}).toString("base64")) });
  assert.deepEqual(pick(mislabelled.result), [["file-types", "design/mock.svg", 2]]);
  const prose = runWith(t, { "notes.md": "# Notes\n\nImages are stored as `data:image/png;base64,...` and `data:image/gif;base64,<payload>` strings.\n" });
  assert.deepEqual(pick(prose.result), []);
});

test("whitespace and line-break entities after the comma or inside the payload do not hide an embed (amendment 7a revised)", (t) => {
  const b64 = xmpPng().toString("base64");
  const wrap = (sep) => b64.match(/.{1,40}/g).join(sep);
  const forms = { "space": " " + b64, "lf": "\n" + b64, "entity": "&#10;" + b64, "hex entity": "&#xA;" + b64, "lf-wrapped": wrap("\n"), "crlf-wrapped": wrap("\r\n  "), "entity-wrapped": wrap("&#13;&#10;") };
  for (const [name, payload] of Object.entries(forms)) {
    const { result } = runWith(t, { "design/mock.svg": svgWith("data:image/png;base64," + payload) });
    assert.deepEqual(pick(result), [["leak-home-path", "design/mock.svg", 2], ["leak-hostname", "design/mock.svg", 2]], name);
  }
  const prose = runWith(t, { "notes.md": "# Notes\n\nUse `data:image/png;base64, ...` or `data:image/png;base64,\n<payload>` here.\n" });
  assert.deepEqual(pick(prose.result), []);
});

function makeJpegWithPath() {
  const data = Buffer.from("Exif\0\0/Users/alice/pic", "latin1");
  const h = Buffer.from([0xff, 0xe1, 0, 0]);
  h.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), h, data, Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}

test("images over the size budget are not parsed; budget-image reports them (security review finding 2)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  fs.writeFileSync(path.join(dir, "design/big.png"), makePng({ text: [{ keyword: "Author", text: "/Users/alice/x" }], totalBytes: 2097153 }));
  const ctx = buildContext(dir, "2026-10-22");
  assert.equal(ctx.images.has("design/big.png"), false);
  const { result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(result.errors.map((f) => [f.rule, f.file]), [["budget-image", "design/big.png"]]);
});
