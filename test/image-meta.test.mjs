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

test("images over the size budget are not parsed; budget-image reports them (security review finding 2)", (t) => {
  const dir = makeTempDir(t); copyMinimalValid(dir);
  fs.writeFileSync(path.join(dir, "design/big.png"), makePng({ text: [{ keyword: "Author", text: "/Users/alice/x" }], totalBytes: 2097153 }));
  const ctx = buildContext(dir, "2026-10-22");
  assert.equal(ctx.images.has("design/big.png"), false);
  const { result } = runJson([dir, "--json", "--today", "2026-10-22"]);
  assert.deepEqual(result.errors.map((f) => [f.rule, f.file]), [["budget-image", "design/big.png"]]);
});
