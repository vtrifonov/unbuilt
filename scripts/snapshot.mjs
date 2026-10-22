import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkInstance, MAX_TEXT_BYTES } from "./lib/walk.mjs";

export const USAGE = "usage: node scripts/snapshot.mjs <instance-dir> <dest-dir>\n       node scripts/snapshot.mjs --help\n";

export const UNSAFE_RE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029\ufe00-\ufe0f\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

const MAX_TOTAL_BYTES = 67108864;
const MAX_FILES = 10000;
const AGENT_FILES = ["claude.md", "claude.local.md", "agents.md", "agents.override.md", "agent.md", "gemini.md"];
const SKIP_KINDS = ["symlink", "fifo", "socket", "device"];

export function sanitize(text) {
  return String(text).replace(UNSAFE_RE, "?");
}

const escapeUnits = (ch) => [...Array(ch.length).keys()].map((i) => "\\u" + ch.charCodeAt(i).toString(16).padStart(4, "0")).join("");

// JSON.stringify already escapes C0 inside strings, so a raw "\n" is layout and every other UNSAFE_RE match is inside a string value.
export function escapeJson(json) {
  return json.replace(UNSAFE_RE, (ch) => (ch === "\n" ? ch : escapeUnits(ch)));
}

export function writeError(err) {
  if (err instanceof InstanceError) {
    process.stderr.write(sanitize(err.message) + "\n");
    return;
  }
  const header = `${err?.name}: ${err?.message}`;
  const stack = String(err?.stack ?? "");
  const frames = stack.startsWith(header) ? stack.slice(header.length) : `\n${stack}`;
  const lines = [`internal error: ${sanitize(err?.message)}`, sanitize(header), ...frames.split("\n").slice(1).map(sanitize)];
  process.stderr.write(lines.join("\n") + "\n");
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
  const walkDirs = new Set(walk.dirs);
  for (const entry of walk.entries) {
    if (entry.kind === "unreadable") {
      if (!hasDotComponent(entry.path) && (walkDirs.has(entry.path) || /\.md$/i.test(entry.path) || entry.path === "unbuilt.yaml")) throw fail(entry.path, "cannot be read");
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
  const nodeModules = new Set(walk.nodeModulesDirs);
  const dirs = new Set(walk.dirs.filter((d) => !nodeModules.has(d)));
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

export function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const flag = argv.find((a) => a.startsWith("--"));
  if (flag !== undefined) return { usageError: `unknown flag: ${flag}` };
  if (argv.length !== 2) return { usageError: "expected exactly two arguments: <instance-dir> <dest-dir>" };
  return { instanceDir: argv[0], destDir: argv[1] };
}

export function snapshotInstance(instanceDir, destDir) {
  const root = path.resolve(instanceDir);
  const dest = path.resolve(destDir);
  const destFail = (reason) => new InstanceError(`${reason}: ${sanitize(dest)}`);
  const lstatOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
  if (lstatOrNull(dest)) throw destFail("destination exists");
  if (!lstatOrNull(path.dirname(dest))?.isDirectory()) throw destFail("destination parent is missing or not a real directory");
  // Compare identities, not path strings: a case-insensitive file system accepts any letter case.
  const rootId = fs.statSync(root, { bigint: true });
  for (let p = fs.realpathSync(path.dirname(dest)); ; p = path.dirname(p)) {
    const st = fs.statSync(p, { bigint: true });
    if (st.dev === rootId.dev && st.ino === rootId.ino) throw destFail("destination is inside the instance");
    if (path.dirname(p) === p) break;
  }
  const { included, excluded, skipped } = scanInstance(root);
  fs.mkdirSync(dest);
  try {
    for (const entry of included) {
      const bytes = readIncludedFile(root, entry.path);
      const target = path.join(dest, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: "wx" });
    }
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw err;
  }
  return { excluded, skipped, copied: included.length };
}

function usageFail(message) {
  process.stderr.write(`${sanitize(message)}\n${USAGE}`);
  process.exitCode = 2;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(USAGE);
      return;
    }
    if (args.usageError) return usageFail(args.usageError);
    const dir = args.instanceDir;
    let stat = null;
    try { stat = fs.statSync(dir); } catch { /* reported below */ }
    if (!stat) return usageFail(`path does not exist: ${dir}`);
    if (!stat.isDirectory()) return usageFail(`not a directory: ${dir}`);
    try { fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK); } catch { return usageFail(`cannot read directory: ${dir}`); }
    const r = snapshotInstance(dir, args.destDir);
    const lines = [...r.excluded.map((p) => `excluded ${sanitize(p)}`), ...r.skipped.map((s) => `skipped ${sanitize(s.path)} (${s.kind})`), `copied ${r.copied} file(s)`];
    process.stdout.write(lines.join("\n") + "\n");
    process.exitCode = r.excluded.length || r.skipped.length ? 1 : 0;
  } catch (err) {
    writeError(err);
    process.exitCode = 2;
  }
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
