import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_IMAGE_BYTES, RULES, SUPPORTED_FORMAT_VERSION, finding, isCalendarDate } from "./lib/rules.mjs";
import { DEFAULT_ALLOW_HOSTS, maskMatch, maskText, scanText } from "./lib/redaction.mjs";
import { walkInstance, readText } from "./lib/walk.mjs";
import { blankCommentsAndFences, findAttempts, findCitations, findScenarioSections } from "./lib/markdown.mjs";
import { createInflateBudget, extractImageText } from "./lib/image-meta.mjs";
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

// A raster embedded in a text file as a data: URI (spec amendment 7a). Only base64 png, jpeg and webp
// can be decoded and scanned; any other data:image/ embed becomes a file-types error.
// Whitespace and the line-break entities &#10; &#13; &#xA; &#xD; may sit after the comma and inside the payload
// (browsers strip them before decoding); at least one payload character is still required, so prose such as
// `data:image/png;base64,...` is not an embed (amendment 7a revised).
const EMBED_RE = /data:image\/([A-Za-z0-9.+-]+)((?:;[A-Za-z0-9=.+-]*)*),((?:\s|&#(?:10|13|x0?[aAdD]);)*[A-Za-z0-9+/=%](?:[A-Za-z0-9+/=%]|\s|&#(?:10|13|x0?[aAdD]);)*)/gi;
const EMBED_BREAKS_RE = /\s|&#(?:10|13|x0?[aAdD]);/g;
const EMBED_FORMATS = { png: "png", jpeg: "jpeg", jpg: "jpeg", webp: "webp" };

// A raster's metadata segments are leak-scanned as they are produced and only the hits are kept, so memory is
// bounded by the hits, not by the inflated text; `run` is the run-wide inflate budget (amendment 7d revised).
function scanImage(buf, run, opts) {
  const hits = [];
  const onSegment = (seg) => { for (const h of scanText(seg, opts)) hits.push(h); };
  const img = extractImageText(buf, { run, onSegment });
  return { format: img.format, error: img.error, hits };
}

function scanEmbed(type, params, payload, run, opts) {
  const format = EMBED_FORMATS[type];
  if (format === undefined) return { error: `data:image/${type} is not png, jpeg or webp`, hits: [] };
  if (!params.split(";").includes("base64")) return { error: `data:image/${type} is not base64-encoded`, hits: [] };
  const buf = Buffer.from(payload.replace(EMBED_BREAKS_RE, ""), "base64");
  if (buf.length > MAX_IMAGE_BYTES) return { error: `decodes to ${buf.length} bytes; the limit is ${MAX_IMAGE_BYTES}`, hits: [] };
  const img = scanImage(buf, run, opts);
  let error = img.error;
  if (error === null && img.format !== format) error = `${img.format} content in a data:image/${type} URI`;
  return { error, hits: img.hits };
}

// An .svg over the image size budget is reported by budget-image, so its embeds are not parsed.
function findEmbeds(texts, files, run, opts) {
  const embeds = [];
  for (const [file, text] of texts) {
    const entry = files.get(file);
    if (entry?.ext === "svg" && entry.size > MAX_IMAGE_BYTES) continue;
    let line = 1;
    let from = 0;
    for (const m of text.matchAll(EMBED_RE)) {
      for (let i = text.indexOf("\n", from); i !== -1 && i < m.index; i = text.indexOf("\n", i + 1)) line++;
      from = m.index;
      embeds.push({ file, line, ...scanEmbed(m[1].toLowerCase(), m[2].toLowerCase(), m[3], run, opts) });
    }
  }
  return embeds;
}

// A Users/<name> or home/<name> chain in a directory path is a home path (amendment 8a clarification). Every
// directory is walked, so the chain is reported once, at the directory whose name ends it.
const HOME_CHAIN_PARENTS = new Set(["Users", "home"]);
const HOME_CHAIN_NAME_RE = /^[A-Za-z0-9._-]+/;
function homeChainName(parent, name) {
  if (!HOME_CHAIN_PARENTS.has(parent)) return null;
  const m = HOME_CHAIN_NAME_RE.exec(name);
  return m && m[0] !== "Shared" ? m[0] : null;
}

// The file column is masked per path segment, the unit leak detection uses; a directory segment that ends a
// home chain is masked whole (amendment 8a clarification).
function maskPath(p, isDir, opts) {
  const segs = p.split("/");
  return segs.map((s, i) => {
    const dirSeg = i < segs.length - 1 || isDir;
    if (dirSeg && i > 0 && homeChainName(segs[i - 1], s) !== null) return maskMatch(s);
    return maskText(s, opts);
  }).join("/");
}

// Leak scanning happens once per text, image segment and path; the five leak-* rules filter these hits by pattern.
// Each file and directory is scanned by its own name (the last path segment), so a leak in a directory name is
// reported once, at the directory, with no line (spec amendment 8a).
function collectLeakHits(texts, images, embeds, paths, dirs, opts) {
  const hits = [];
  const keep = (file, found, line) => {
    for (const h of found) hits.push({ file, line: line === undefined ? h.line : line, match: h.match, pattern: h.pattern, kind: h.kind });
  };
  for (const p of paths) if (p !== "") keep(p, scanText(p.slice(p.lastIndexOf("/") + 1), opts), null);
  for (const d of dirs) {
    const segs = d.split("/");
    const name = segs.length > 1 ? homeChainName(segs[segs.length - 2], segs[segs.length - 1]) : null;
    if (name !== null) hits.push({ file: d, line: null, match: `/${segs[segs.length - 2]}/${name}`, pattern: "home-path" });
  }
  for (const [file, text] of texts) keep(file, scanText(text, opts));
  for (const [file, img] of images) keep(file, img.hits, null);
  for (const e of embeds) keep(e.file, e.hits, e.line);
  return hits;
}

// `lines` is the scenarios file split once; each section scans only its own slice.
function sectionCitations(lines, section, knownPrefixes) {
  const text = lines.slice(section.startLine - 1, section.endLine).join("\n");
  return findCitations(text, knownPrefixes).map((c) => ({ id: c.id, line: c.line + section.startLine - 1 }));
}

export function buildContext(root, today) {
  const { entries, dirs, nodeModulesDirs } = walkInstance(root);
  const files = new Map(entries.filter((e) => e.kind === "file").map((e) => [e.path, e]));
  const texts = new Map();
  const rasters = [];
  for (const e of files.values()) {
    if (e.isText && !e.tooLarge) {
      try { texts.set(e.path, readText(path.join(root, e.path))); } catch { /* unreadable */ }
    } else if (IMAGE_META_EXTS.includes(e.ext) && e.size <= MAX_IMAGE_BYTES) {
      // An image over the size budget is reported by budget-image and never read or parsed.
      rasters.push(e);
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
    const lines = text.split("\n");
    for (const s of findScenarioSections(text)) scenarios.push({ file, title: s.title, startLine: s.startLine, endLine: s.endLine, citations: sectionCitations(lines, s, knownPrefixes) });
  }
  const citations = new Map();
  for (const [p, text] of prose) citations.set(p, findCitations(text, knownPrefixes));
  const allowHosts = DEFAULT_ALLOW_HOSTS;
  const exactHosts = metaUsable ? exactHostsOf(meta) : [];
  const leakOpts = { allowHosts, exactHosts };
  // Rasters are read after unbuilt.yaml so their metadata can be scanned with the instance's public hosts.
  const run = createInflateBudget();
  const images = new Map();
  for (const e of rasters) {
    let buf = null;
    try { buf = fs.readFileSync(path.join(root, e.path)); } catch { /* unreadable */ }
    if (buf) images.set(e.path, scanImage(buf, run, leakOpts));
  }
  const embeds = findEmbeds(texts, files, run, leakOpts);
  const leakHits = collectLeakHits(texts, images, embeds, [...entries.map((e) => e.path), ...dirs], dirs, leakOpts);
  return {
    root, today, entries, dirs: new Set(dirs), files, texts, images, embeds, nodeModulesDirs, yaml, meta, versionError, metaUsable,
    modules, moduleIds, prose, declFiles, attempts, declarations, scenarioFiles, scenarios, citations,
    allowHosts, exactHosts, leakHits,
  };
}

export function runRules(ctx) {
  const findings = [];
  if (ctx.versionError) {
    findings.push(finding("error", "yaml-fields", "unbuilt.yaml", ctx.yaml.lines.get("unbuilt"), "format version " + ctx.meta.unbuilt + " is not supported by this validator (supports " + SUPPORTED_FORMAT_VERSION + "); see CHANGELOG.md"));
  } else {
    // A loop, not a spread into push: spreading 120,000 or more findings as arguments overflows the call stack.
    for (const r of RULES) if (!r.needsMeta || ctx.metaUsable) for (const f of r.fn(ctx)) findings.push(f);
  }
  // Every message and file column, the version short-circuit included, is masked as the last step (amendment 8a).
  const opts = { allowHosts: ctx.allowHosts, exactHosts: ctx.exactHosts };
  return findings.map((f) => ({ ...f, file: maskPath(f.file, ctx.dirs.has(f.file), opts), message: maskText(f.message, opts) }));
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
    // A directory must be listable (R) and searchable (X); with R alone every entry beneath it is unreadable.
    try { fs.accessSync(args.dir, fs.constants.R_OK | fs.constants.X_OK); } catch { return usageFail(`cannot read directory: ${args.dir}`); }
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
