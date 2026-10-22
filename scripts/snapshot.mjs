import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkInstance, MAX_TEXT_BYTES } from "./lib/walk.mjs";

export const USAGE = "usage: node scripts/snapshot.mjs <instance-dir> <dest-dir>\n       node scripts/snapshot.mjs --help\n";

export const UNSAFE_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/gu;
export const JSON_ESCAPE_RE = /[\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/gu;

const MAX_TOTAL_BYTES = 67108864;
const MAX_FILES = 10000;
const AGENT_FILES = ["claude.md", "claude.local.md", "agents.md", "agent.md", "gemini.md"];
const SKIP_KINDS = ["symlink", "fifo", "socket", "device"];

export function sanitize(text) {
  return String(text).replace(UNSAFE_RE, "?");
}

export class InstanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstanceError";
  }
}

const fail = (rel, reason) => new InstanceError(`${sanitize(rel)}: ${reason}`);
const hasDotComponent = (rel) => rel.split("/").some((c) => c.startsWith("."));
const basename = (rel) => rel.slice(rel.lastIndexOf("/") + 1);

export function includeRule(entry) {
  if (entry.kind !== "file") return "ignore";
  if (entry.path !== "unbuilt.yaml" && !(entry.isText && entry.ext === "md")) return "ignore";
  if (hasDotComponent(entry.path) || AGENT_FILES.includes(basename(entry.path).toLowerCase())) return "exclude";
  return "include";
}

export function scanInstance(root) {
  const walk = walkInstance(path.resolve(root));
  const included = [];
  const excluded = [];
  const skipped = [];
  for (const entry of walk.entries) {
    if (entry.kind === "unreadable") {
      if (!hasDotComponent(entry.path) && (walk.dirs.includes(entry.path) || /\.md$/i.test(entry.path) || entry.path === "unbuilt.yaml")) throw fail(entry.path, "cannot be read");
      continue;
    }
    if (SKIP_KINDS.includes(entry.kind)) {
      if (/\.md$/i.test(basename(entry.path)) || entry.path === "unbuilt.yaml") skipped.push({ path: entry.path, kind: entry.kind });
      continue;
    }
    const rule = includeRule(entry);
    if (rule === "include") {
      if (entry.tooLarge) throw fail(entry.path, `larger than ${MAX_TEXT_BYTES} bytes`);
      included.push(entry);
    } else if (rule === "exclude") {
      excluded.push(entry.path);
    }
  }
  if (included.length > MAX_FILES) throw fail(".", `more than ${MAX_FILES} included files`);
  if (included.reduce((sum, e) => sum + e.size, 0) > MAX_TOTAL_BYTES) throw fail(".", `included files total more than ${MAX_TOTAL_BYTES} bytes`);
  const dirs = new Set(walk.dirs.filter((d) => !walk.nodeModulesDirs.includes(d)));
  return { included, excluded, skipped, dirs };
}

export function readIncludedFile(instanceRoot, relPath) {
  const abs = path.join(instanceRoot, relPath);
  const moved = () => fail(relPath, "changed type or moved after the walk");
  let fd;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch {
    throw moved();
  }
  try {
    let realOk = false;
    try {
      const st = fs.fstatSync(fd);
      realOk = st.isFile() && st.size <= MAX_TEXT_BYTES && fs.realpathSync(abs) === path.join(fs.realpathSync(instanceRoot), relPath);
    } catch {
      realOk = false;
    }
    if (!realOk) throw moved();
    const buf = Buffer.allocUnsafe(MAX_TEXT_BYTES + 1);
    let n = 0;
    try {
      while (n < buf.length) {
        const got = fs.readSync(fd, buf, n, buf.length - n, null);
        if (got === 0) break;
        n += got;
      }
    } catch {
      throw fail(relPath, "cannot be read");
    }
    if (n > MAX_TEXT_BYTES) throw fail(relPath, `grew past ${MAX_TEXT_BYTES} bytes`);
    return Buffer.from(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
}

function main() {
  process.stderr.write(USAGE);
  process.exitCode = 2;
}

// Node resolves import.meta.url to the real path but leaves argv[1] as typed, so compare real paths.
function isEntryScript() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return true;
  }
}

if (isEntryScript()) main();
