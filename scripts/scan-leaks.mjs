import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { MAX_IMAGE_BYTES, RULES } from "./lib/rules.mjs";
import { buildContext, maskFindings, sortFindings } from "./validate.mjs";

// Runs only the validator's leak-* rules on any directory: no structure rules, no unbuilt.yaml required.
// It scans file contents, image metadata and path names for known shapes (FORMAT.md §7). It does not run the
// extract skill's per-name pass, and it reads the working tree only, never git history.

export const USAGE = "usage: node scripts/scan-leaks.mjs <dir> [--json] [--allow-host <host>]...\n       node scripts/scan-leaks.mjs --help\n";

const LEAK_RULES = RULES.filter((r) => r.name.startsWith("leak-"));
const META_EXTS = ["png", "jpg", "jpeg", "webp"];

export function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const positionals = [];
  const allowHosts = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--allow-host") {
      const v = argv[++i];
      if (v === undefined || v === "" || v.startsWith("-")) return { usageError: "--allow-host needs a host" };
      allowHosts.push(v.toLowerCase());
    } else if (a.startsWith("--")) return { usageError: `unknown flag: ${a}` };
    else positionals.push(a);
  }
  if (positionals.length === 0) return { usageError: "missing directory" };
  if (positionals.length > 1) return { usageError: "expected exactly one directory" };
  return { dir: positionals[0], json, allowHosts };
}

// Why an entry was not scanned, or null when it was. Mirrors what buildContext reads.
function skipReason(e) {
  if (e.kind === "symlink") return "symlink";
  if (e.kind === "unreadable") return "unreadable";
  if (e.kind !== "file") return "special file";
  if (e.isText) return e.tooLarge ? "too large to scan" : null;
  if (META_EXTS.includes(e.ext)) return e.size > MAX_IMAGE_BYTES ? "image too large to scan" : null;
  return "binary";
}

export function scanLeaks(dir, { allowHosts = [] } = {}) {
  const ctx = buildContext(dir, "1970-01-01", { extraHosts: allowHosts });
  const raw = [];
  for (const r of LEAK_RULES) for (const f of r.fn(ctx)) raw.push(f);
  const findings = sortFindings(maskFindings(ctx, raw));
  const skippedRaw = [];
  for (const e of ctx.entries) {
    const reason = skipReason(e);
    if (reason !== null) skippedRaw.push({ file: e.path, message: reason });
  }
  const skipped = maskFindings(ctx, skippedRaw).map((s) => ({ file: s.file, reason: s.message }));
  return { findings, skipped };
}

function item(f) {
  const o = { rule: f.rule, file: f.file };
  if (f.line) o.line = f.line;
  o.message = f.message;
  return o;
}

export function formatHuman({ findings, skipped }) {
  const lines = findings.map((f) => `${f.rule.padEnd(17)}  ${f.file}${f.line ? ":" + f.line : ""}  ${f.message}`);
  for (const s of skipped) lines.push(`skipped  ${s.file}  ${s.reason}`);
  lines.push(findings.length === 0 ? "ok: no leaks found" : `${findings.length} leak(s) found`);
  return lines.join("\n") + "\n";
}

export function formatJson({ findings, skipped }) {
  return JSON.stringify({ leaks: findings.map(item), skipped }, null, 2) + "\n";
}

function usageFail(message) {
  process.stderr.write(`${message}\n${USAGE}`);
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
    let stat = null;
    try { stat = fs.statSync(args.dir); } catch { /* reported below */ }
    if (!stat) return usageFail(`path does not exist: ${args.dir}`);
    if (!stat.isDirectory()) return usageFail(`not a directory: ${args.dir}`);
    try { fs.accessSync(args.dir, fs.constants.R_OK | fs.constants.X_OK); } catch { return usageFail(`cannot read directory: ${args.dir}`); }
    const result = scanLeaks(args.dir, { allowHosts: args.allowHosts });
    process.stdout.write(args.json ? formatJson(result) : formatHuman(result));
    process.exitCode = result.findings.length > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`internal error: ${err.message}\n${err.stack}\n`);
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
