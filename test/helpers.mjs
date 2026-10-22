import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(REPO_ROOT, "scripts", "validate.mjs");
export const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");

export function runCli(args, { env, cwd } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function runJson(args, opts) {
  const r = runCli(args, opts);
  return { ...r, result: JSON.parse(r.stdout) };
}

export function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unbuilt-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeIn(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function readIn(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

export function copyMinimalValid(dir) {
  fs.cpSync(path.join(FIXTURES, "minimal-valid"), dir, { recursive: true });
}

export function has(result, rule, level, file) {
  const list = level === "error" ? result.errors : result.warnings;
  return list.some((f) => f.rule === rule && (file === undefined || f.file === file));
}

function generateModules(dir, count) {
  const ids = Array.from({ length: count - 1 }, (_, i) => "A" + String.fromCharCode(0x41 + i));
  const entries = ids.map((id) => `  - id: ${id}\n    path: modules/${id.toLowerCase()}\n    maturity: shipped\n`).join("");
  const yaml = readIn(dir, "unbuilt.yaml");
  if (!yaml.includes("\nsubstitutions:\n")) throw new Error("generate.modules: unbuilt.yaml has no substitutions: key after modules:");
  writeIn(dir, "unbuilt.yaml", yaml.replace("\nsubstitutions:\n", `\n${entries}substitutions:\n`));
  for (const id of ids) {
    const m = `modules/${id.toLowerCase()}`;
    writeIn(dir, `${m}/problem.md`, "# Problem\n\ntext\n");
    writeIn(dir, `${m}/SPEC.md`, `# X\n\n- **${id}-1** (MUST) Does one thing.\n`);
    writeIn(dir, `${m}/scenarios.md`, `# S\n\n## One\n\nCovers: ${id}-1\n`);
  }
  writeIn(dir, "substitutions/README.md", "# Substitutions\n\n| Module | storage |\n|---|---|\n| CORE | required |\n" + ids.map((id) => `| ${id} | - |\n`).join(""));
}

function generateWords(n) {
  const lines = [];
  for (let left = n; left > 0; left -= 200) lines.push(Array(Math.min(200, left)).fill("w").join(" "));
  return lines.join("\n") + "\n";
}

function generate(dir, spec) {
  for (const key of Object.keys(spec)) {
    switch (key) {
      case "file":
        break;
      case "lines":
        writeIn(dir, spec.file, "w\n".repeat(spec.lines));
        break;
      case "words":
        writeIn(dir, spec.file, generateWords(spec.words));
        break;
      case "png":
        writeIn(dir, spec.file, makePng({ totalBytes: spec.png }));
        break;
      case "modules":
        generateModules(dir, spec.modules);
        break;
      default:
        throw new Error(`unknown generate key: ${key}`);
    }
  }
}

function overlayFiles(srcDir, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
    const r = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (rel === "" && (ent.name === "DELETE" || ent.name === "expect.json")) continue;
    if (ent.isDirectory()) out.push(...overlayFiles(srcDir, r));
    else out.push(r);
  }
  return out;
}

export function applyFixture(ruleName, dir) {
  const src = path.join(FIXTURES, ruleName);
  const expect = JSON.parse(fs.readFileSync(path.join(src, "expect.json"), "utf8"));
  copyMinimalValid(dir);
  const del = path.join(src, "DELETE");
  if (fs.existsSync(del)) {
    for (const line of fs.readFileSync(del, "utf8").split("\n")) {
      const rel = line.trim();
      if (rel !== "") fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    }
  }
  for (const rel of overlayFiles(src)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.join(src, rel), abs);
  }
  if (expect.generate) generate(dir, expect.generate);
  return expect;
}

export function runFixture(t, ruleName, { mutate } = {}) {
  const dir = makeTempDir(t);
  const expect = applyFixture(ruleName, dir);
  if (mutate) mutate(dir);
  const r = runJson([dir, "--json", "--today", expect.today ?? "2026-10-22"]);
  return { expect, dir, code: r.code, result: r.result };
}

const PNG_MAGIC =Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

export function makePng({ text = [], ztxt = [], itxt = [], exif = null, idatBytes = 16, corruptZtxt = false, truncate = false, totalBytes = null, textAfterIdat = [] } = {}) {
  const z = Buffer.from([0]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const head = [PNG_MAGIC, pngChunk("IHDR", ihdr)];
  const before = [];
  for (const { keyword, text: t } of text) before.push(pngChunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), z, Buffer.from(t, "latin1")])));
  for (const { keyword, text: t, deflated = null } of ztxt) {
    const body = corruptZtxt ? Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]) : deflated ?? zlib.deflateSync(Buffer.from(t, "latin1"));
    before.push(pngChunk("zTXt", Buffer.concat([Buffer.from(keyword, "latin1"), z, Buffer.from([0]), body])));
  }
  for (const { keyword, text: t, compressed = false, deflated = null } of itxt) {
    const body = deflated ?? (compressed ? zlib.deflateSync(Buffer.from(t, "utf8")) : Buffer.from(t, "utf8"));
    before.push(pngChunk("iTXt", Buffer.concat([Buffer.from(keyword, "latin1"), z, Buffer.from([compressed ? 1 : 0, 0]), z, z, body])));
  }
  if (exif !== null) before.push(pngChunk("eXIf", Buffer.from(exif, "latin1")));
  const after = textAfterIdat.map(({ keyword, text: t }) => pngChunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), z, Buffer.from(t, "latin1")])));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  let idatLen = idatBytes;
  if (totalBytes !== null) {
    const fixed = [...head, ...before, ...after, iend].reduce((n, b) => n + b.length, 0) + 12;
    idatLen = totalBytes - fixed;
    if (idatLen < 0) throw new Error(`makePng: totalBytes ${totalBytes} is smaller than ${fixed}`);
  }
  const buf = Buffer.concat([...head, ...before, pngChunk("IDAT", Buffer.alloc(idatLen)), ...after, iend]);
  if (truncate) return buf.subarray(0, PNG_MAGIC.length + 25 + 5);
  return buf;
}

export function makeJpeg({ app1 = [], com = [], raw = null } = {}) {
  const soi = Buffer.from([0xff, 0xd8]);
  if (raw) return Buffer.concat([soi, raw]);
  const seg = (marker, s) => {
    const data = Buffer.from(s, s.startsWith("http://ns.adobe.com/xap/1.0/") ? "utf8" : "latin1");
    const h = Buffer.from([0xff, marker, 0, 0]);
    h.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([soi, ...app1.map((s) => seg(0xe1, s)), ...com.map((s) => seg(0xfe, s)), Buffer.from([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9])]);
}

export function makeWebp({ exif = null, xmp = null, raw = null, riffSize = null } = {}) {
  const chunk = (fourcc, data) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(data.length);
    return Buffer.concat([Buffer.from(fourcc, "latin1"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  let body;
  if (raw) body = raw;
  else {
    const parts = [];
    if (exif !== null) parts.push(chunk("EXIF", Buffer.from(exif, "latin1")));
    if (xmp !== null) parts.push(chunk("XMP ", Buffer.from(xmp, "utf8")));
    body = Buffer.concat(parts);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32LE(riffSize ?? 4 + body.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), size, Buffer.from("WEBP", "latin1"), body]);
}
