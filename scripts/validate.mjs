import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, SUPPORTED_FORMAT_VERSION, finding, isCalendarDate } from "./lib/rules.mjs";
import { DEFAULT_ALLOW_HOSTS, maskText } from "./lib/redaction.mjs";
import { walkInstance, readText } from "./lib/walk.mjs";
import { blankCommentsAndFences, findAttempts, findCitations, findScenarioSections } from "./lib/markdown.mjs";
import { extractImageText } from "./lib/image-meta.mjs";
import { parse } from "./lib/yaml-subset.mjs";

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

const IMAGE_META_EXTS = ["png", "jpg", "jpeg", "webp"];

function exactHostsOf(meta) {
  const hosts = [];
  const ref = meta.reference_impl;
  if (typeof ref === "string" && (ref.startsWith("https://") || ref.startsWith("http://"))) {
    try { hosts.push(new URL(ref).hostname.toLowerCase()); } catch { /* not a URL */ }
  }
  if (Array.isArray(meta.public_hosts)) for (const h of meta.public_hosts) if (typeof h === "string") hosts.push(h);
  return hosts;
}

function normaliseModules(meta, yaml) {
  if (!Array.isArray(meta.modules)) return [];
  const str = (v) => (typeof v === "string" ? v : null);
  return meta.modules.map((m, index) => {
    const obj = m !== null && typeof m === "object" ? m : {};
    const p = str(obj.path);
    return { index, id: str(obj.id), path: p, dir: p === null ? null : p.replace(/\/+$/, ""), maturity: str(obj.maturity), line: yaml.lines.get(`modules[${index}]`) ?? null };
  });
}

function sectionCitations(prose, section, knownPrefixes) {
  const lines = prose.split("\n").slice(section.startLine - 1, section.endLine).join("\n");
  return findCitations(lines, knownPrefixes).map((c) => ({ id: c.id, line: c.line + section.startLine - 1 }));
}

export function buildContext(root, today) {
  const { entries, dirs, nodeModulesDirs } = walkInstance(root);
  const files = new Map(entries.filter((e) => e.kind === "file").map((e) => [e.path, e]));
  const texts = new Map();
  const images = new Map();
  for (const e of files.values()) {
    const abs = path.join(root, e.path);
    if (e.isText && !e.tooLarge) {
      try { texts.set(e.path, readText(abs)); } catch { /* unreadable */ }
    } else if (IMAGE_META_EXTS.includes(e.ext)) {
      let buf = null;
      try { buf = fs.readFileSync(abs); } catch { /* unreadable */ }
      if (buf) images.set(e.path, extractImageText(buf));
    }
  }
  const yaml = texts.has("unbuilt.yaml") ? parse(texts.get("unbuilt.yaml")) : null;
  const meta = yaml && yaml.errors.length === 0 ? yaml.value : null;
  const versionError = meta !== null && typeof meta.unbuilt === "number" && meta.unbuilt !== SUPPORTED_FORMAT_VERSION;
  const metaUsable = meta !== null && !versionError;
  const modules = metaUsable ? normaliseModules(meta, yaml) : [];
  const moduleIds = modules.map((m) => m.id).filter((id) => id !== null);
  const knownPrefixes = [...moduleIds, "INV"];
  const prose = new Map();
  for (const [p, text] of texts) if (p.endsWith(".md")) prose.set(p, blankCommentsAndFences(text));
  const moduleDirs = modules.map((m) => m.dir).filter((d) => d !== null);
  const declFiles = [...new Set(["SPEC.md", ...moduleDirs.map((d) => d + "/SPEC.md")])].filter((f) => prose.has(f));
  const attempts = [];
  if (metaUsable) for (const file of declFiles) for (const a of findAttempts(prose.get(file), knownPrefixes)) attempts.push({ ...a, file });
  const declarations = attempts.filter((a) => a.exact !== null).map((a) => ({ id: a.exact.id, prefix: a.exact.prefix, num: a.exact.num, modality: a.exact.modality, retired: a.exact.retired, inferred: a.exact.inferred, file: a.file, line: a.line }));
  const scenarioFiles = [...new Set(moduleDirs.map((d) => d + "/scenarios.md"))].filter((f) => prose.has(f));
  const scenarios = [];
  for (const file of scenarioFiles) {
    const text = prose.get(file);
    for (const s of findScenarioSections(text)) scenarios.push({ file, title: s.title, startLine: s.startLine, endLine: s.endLine, citations: sectionCitations(text, s, knownPrefixes) });
  }
  const citations = new Map();
  for (const [p, text] of prose) citations.set(p, findCitations(text, knownPrefixes));
  return {
    root, today, entries, dirs: new Set(dirs), files, texts, images, nodeModulesDirs, yaml, meta, versionError, metaUsable,
    modules, moduleIds, prose, declFiles, attempts, declarations, scenarioFiles, scenarios, citations,
    allowHosts: DEFAULT_ALLOW_HOSTS, exactHosts: metaUsable ? exactHostsOf(meta) : [],
  };
}

export function runRules(ctx) {
  if (ctx.versionError) {
    return [finding("error", "yaml-fields", "unbuilt.yaml", ctx.yaml.lines.get("unbuilt"), "format version " + ctx.meta.unbuilt + " is not supported by this validator (supports " + SUPPORTED_FORMAT_VERSION + "); see CHANGELOG.md")];
  }
  const findings = [];
  for (const r of RULES) if (!r.needsMeta || ctx.metaUsable) findings.push(...r.fn(ctx));
  const opts = { allowHosts: ctx.allowHosts, exactHosts: ctx.exactHosts };
  return findings.map((f) => ({ ...f, message: maskText(f.message, opts) }));
}

export function validate(dir, today) {
  const root = path.resolve(dir);
  const ctx = buildContext(root, today);
  if (process.env.UNBUILT_VALIDATE_THROW === "1") throw new Error("UNBUILT_VALIDATE_THROW is set");
  return { findings: sortFindings(runRules(ctx)), name: ctx.meta?.name ?? path.basename(root) };
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
