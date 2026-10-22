import fs from "node:fs";
import path from "node:path";

export const RASTER_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "ico", "avif"];
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];
export const MAX_TEXT_BYTES = 5242880;
const HEAD_BYTES = 8192;

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

function readHead(abs) {
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function classify(abs, rel, name, stat) {
  const base = { path: rel, kind: "file", size: stat.size, ext: extOf(name), isText: false, isRaster: false, tooLarge: stat.size > MAX_TEXT_BYTES };
  if (stat.isSymbolicLink()) return { ...base, kind: "symlink" };
  if (stat.isFIFO()) return { ...base, kind: "fifo" };
  if (stat.isSocket()) return { ...base, kind: "socket" };
  if (stat.isCharacterDevice() || stat.isBlockDevice()) return { ...base, kind: "device" };
  base.isRaster = RASTER_EXTENSIONS.includes(base.ext);
  try {
    const head = readHead(abs);
    base.isText = !base.isRaster && !head.includes(0);
  } catch {
    return { ...base, kind: "unreadable" };
  }
  return base;
}

export function walkInstance(root) {
  const entries = [];
  const dirs = [];
  const nodeModulesDirs = [];
  const visit = (relDir) => {
    const absDir = relDir === "" ? root : path.join(root, relDir);
    let names;
    try {
      names = fs.readdirSync(absDir);
    } catch {
      entries.push({ path: relDir, kind: "unreadable", size: 0, ext: "", isText: false, isRaster: false, tooLarge: false });
      return;
    }
    for (const name of names) {
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      const abs = path.join(root, rel);
      let stat;
      try {
        stat = fs.lstatSync(abs);
      } catch {
        entries.push({ path: rel, kind: "unreadable", size: 0, ext: extOf(name), isText: false, isRaster: false, tooLarge: false });
        continue;
      }
      if (stat.isDirectory()) {
        if (name === ".git") continue;
        dirs.push(rel);
        if (name === "node_modules") nodeModulesDirs.push(rel);
        else visit(rel);
        continue;
      }
      entries.push(classify(abs, rel, name, stat));
    }
  };
  visit("");
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  entries.sort(byPath);
  dirs.sort();
  nodeModulesDirs.sort();
  return { entries, dirs, nodeModulesDirs };
}

export function readText(absPath) {
  const buf = fs.readFileSync(absPath);
  return new TextDecoder("utf-8").decode(buf);
}
