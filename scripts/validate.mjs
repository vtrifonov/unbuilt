import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isCalendarDate } from "./lib/rules.mjs";

export const USAGE = "usage: node scripts/validate.mjs <instance-dir> [--json] [--today YYYY-MM-DD]\n       node scripts/validate.mjs --help\n";

export function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const positionals = [];
  let json = false;
  let today = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--today") {
      const v = argv[++i];
      if (v === undefined) return { usageError: "--today needs a value" };
      if (!isCalendarDate(v)) return { usageError: `malformed --today value: ${v}` };
      today = v;
    } else if (a.startsWith("--")) return { usageError: `unknown flag: ${a}` };
    else positionals.push(a);
  }
  if (positionals.length === 0) return { usageError: "missing instance directory" };
  if (positionals.length > 1) return { usageError: "expected exactly one instance directory" };
  return { dir: positionals[0], json, today: today ?? localDate() };
}

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sortFindings(findings) {
  const level = (f) => (f.level === "error" ? 0 : 1);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...findings].sort((a, b) =>
    level(a) - level(b) || cmp(a.file, b.file) || (a.line || 0) - (b.line || 0) || cmp(a.rule, b.rule) || cmp(a.message, b.message));
}

export function formatHuman(findings, instanceName) {
  const sorted = sortFindings(findings);
  const lines = sorted.map((f) => `${f.level.padEnd(8)} ${f.rule.padEnd(17)}  ${f.file}${f.line ? ":" + f.line : ""}  ${f.message}`);
  const errors = sorted.filter((f) => f.level === "error").length;
  const warnings = sorted.length - errors;
  lines.push(sorted.length === 0 ? `ok: ${instanceName} passes unbuilt format 1` : `${errors} error(s), ${warnings} warning(s)`);
  return lines.join("\n") + "\n";
}

export function formatJson(findings) {
  const item = (f) => {
    const o = { rule: f.rule, file: f.file };
    if (f.line) o.line = f.line;
    o.message = f.message;
    return o;
  };
  const sorted = sortFindings(findings);
  return JSON.stringify({
    errors: sorted.filter((f) => f.level === "error").map(item),
    warnings: sorted.filter((f) => f.level !== "error").map(item),
  }, null, 2) + "\n";
}

function validate(dir, today) {
  void today;
  if (process.env.UNBUILT_VALIDATE_THROW === "1") throw new Error("UNBUILT_VALIDATE_THROW is set");
  return { findings: [], name: path.basename(path.resolve(dir)) };
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
    const { findings, name } = validate(args.dir, args.today);
    process.stdout.write(args.json ? formatJson(findings) : formatHuman(findings, name));
    process.exitCode = findings.some((f) => f.level === "error") ? 1 : 0;
  } catch (err) {
    process.stderr.write(`internal error: ${err.message}\n${err.stack}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
