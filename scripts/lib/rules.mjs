import { maskMatch, scanText } from "./redaction.mjs";
import { countLines, countWords } from "./markdown.mjs";

export const SUPPORTED_FORMAT_VERSION = 1;

export const RULES = [];

export function finding(level, rule, file, line, message) {
  const f = { level, rule, file };
  if (line !== null && line !== undefined) f.line = line;
  f.message = message;
  return f;
}

const REQUIRED_FILES = ["README.md", "unbuilt.yaml", "SPEC.md", "constraints.md", "BUILD.md"];
const MODULE_FILES = ["problem.md", "SPEC.md", "scenarios.md"];

export function requiredFiles(ctx) {
  return REQUIRED_FILES.filter((name) => !ctx.files.has(name))
    .map((name) => finding("error", "required-files", name, null, `required file ${name} is missing (FORMAT.md §3)`));
}

export function moduleFiles(ctx) {
  const out = [];
  const seen = new Set();
  for (const m of ctx.modules) {
    if (typeof m.dir !== "string" || !ctx.dirs.has(m.dir) || seen.has(m.dir)) continue;
    seen.add(m.dir);
    for (const name of MODULE_FILES) {
      if (!ctx.files.has(`${m.dir}/${name}`)) out.push(finding("error", "module-files", `${m.dir}/${name}`, null, `module ${m.id ?? m.index + 1} is missing ${name} (FORMAT.md §3)`));
    }
  }
  return out;
}

export function yamlParse(ctx) {
  if (!ctx.yaml) return [];
  return ctx.yaml.errors.map((e) => finding("error", "yaml-parse", "unbuilt.yaml", e.line, `${e.message.replace(/^line \d+: /, "")} (FORMAT.md §10)`));
}

const TOP_KEYS = ["unbuilt", "name", "summary", "origin", "reference_impl", "license", "has_ui", "platforms", "original_stack", "original_effort", "interview", "implementation_terms", "modules", "substitutions", "public_hosts"];
const MODULE_KEYS = ["id", "path", "maturity"];
const ORIGINS = ["extracted-from-public-implementation", "extracted-from-private-implementation", "designed-not-built"];
const MATURITIES = ["shipped", "partial", "sketched", "abandoned"];
const EFFORTS = ["S", "M", "L", "XL"];
const INTERVIEWS = ["author", "partial", "none"];
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;

const isStr = (v) => typeof v === "string";
const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function isIpLiteral(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  return IPV6_RE.test(s) && (s.match(/::/g) ?? []).length <= 1 && !s.includes(":::");
}

export function yamlFields(ctx) {
  const out = [];
  const meta = ctx.meta;
  const L = (key) => ctx.yaml.lines.get(key);
  const err = (key, msg) => out.push(finding("error", "yaml-fields", "unbuilt.yaml", L(key), msg));
  const has = (k) => Object.hasOwn(meta, k);
  for (const k of Object.keys(meta)) {
    if (!TOP_KEYS.includes(k)) out.push(finding("warning", "yaml-fields", "unbuilt.yaml", L(k), `unknown key ${k} is ignored (FORMAT.md §3)`));
  }
  if (!has("unbuilt")) err("unbuilt", "unbuilt is required (FORMAT.md §3)");
  else if (meta.unbuilt !== 1) err("unbuilt", "unbuilt must be the integer 1 (FORMAT.md §2)");
  if (!has("name")) err("name", "name is required (FORMAT.md §3)");
  else if (!isStr(meta.name) || meta.name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name)) err("name", `name "${meta.name}" must be kebab-case of at most 64 characters (FORMAT.md §3)`);
  if (!has("summary")) err("summary", "summary is required (FORMAT.md §3)");
  else if (!isStr(meta.summary) || meta.summary.length < 1 || meta.summary.length > 200) err("summary", "summary must be a string of 1 to 200 characters (FORMAT.md §3)");
  for (const key of ["origin", "reference_impl"]) {
    if (!has(key)) err(key, `${key} is required (FORMAT.md §3)`);
    else if (!isStr(meta[key])) err(key, `${key} must be a string (FORMAT.md §3)`);
  }
  if (isStr(meta.origin) && isStr(meta.reference_impl) && ORIGINS.includes(meta.origin)) {
    const ref = meta.reference_impl;
    if (meta.origin === ORIGINS[0] && !/^https:\/\/\S+$/.test(ref)) err("reference_impl", "reference_impl must be an https:// URL when origin is extracted-from-public-implementation (FORMAT.md §3)");
    if (meta.origin === ORIGINS[1] && ref !== "private") err("reference_impl", "reference_impl must be the literal private when origin is extracted-from-private-implementation (FORMAT.md §3)");
    if (meta.origin === ORIGINS[2] && ref !== "none") err("reference_impl", "reference_impl must be the literal none when origin is designed-not-built (FORMAT.md §3)");
  }
  if (!has("license")) err("license", "license is required (FORMAT.md §3)");
  else if (!isStr(meta.license) || meta.license === "" || /\s/.test(meta.license)) err("license", "license must be a non-empty string without spaces (FORMAT.md §3)");
  if (!has("has_ui")) err("has_ui", "has_ui is required (FORMAT.md §3)");
  else if (typeof meta.has_ui !== "boolean") err("has_ui", "has_ui must be true or false (FORMAT.md §3)");
  if (!has("platforms")) err("platforms", "platforms is required (FORMAT.md §3)");
  else if (!Array.isArray(meta.platforms) || meta.platforms.length === 0) err("platforms", `platforms must be a non-empty list of lowercase tokens; "${Array.isArray(meta.platforms) ? "" : meta.platforms}" is not (FORMAT.md §3)`);
  else meta.platforms.forEach((v, i) => {
    if (!isStr(v) || !/^[a-z0-9][a-z0-9-]*$/.test(v)) err(`platforms[${i}]`, `platforms must be a non-empty list of lowercase tokens; "${v}" is not (FORMAT.md §3)`);
  });
  for (const key of ["original_stack", "substitutions", "public_hosts"]) {
    if (has(key) && (!Array.isArray(meta[key]) || !meta[key].every(isStr))) err(key, `${key} must be a list of strings (FORMAT.md §3)`);
  }
  for (const key of ["original_effort", "interview", "implementation_terms"]) {
    if (has(key) && !isStr(meta[key])) err(key, `${key} must be a string (FORMAT.md §3)`);
  }
  if (Array.isArray(meta.public_hosts) && meta.public_hosts.every(isStr)) {
    const seen = new Set();
    meta.public_hosts.forEach((v, i) => {
      if (!HOSTNAME_RE.test(v) && !isIpLiteral(v)) err(`public_hosts[${i}]`, `public_hosts entry "${v}" is not a lowercase hostname or an IP literal (FORMAT.md §7)`);
      else if (seen.has(v)) err(`public_hosts[${i}]`, `public_hosts entry "${v}" is listed twice (FORMAT.md §7)`);
      seen.add(v);
    });
  }
  if (!has("modules")) err("modules", "modules is required (FORMAT.md §3)");
  else if (!Array.isArray(meta.modules) || meta.modules.length === 0 || !meta.modules.every(isMap)) err("modules", "modules must be a non-empty list of maps (FORMAT.md §3)");
  else meta.modules.forEach((m, i) => {
    for (const key of MODULE_KEYS) {
      if (!Object.hasOwn(m, key)) err(`modules[${i}]`, `module ${i + 1} is missing ${key} (FORMAT.md §3)`);
      else if (!isStr(m[key])) err(`modules[${i}].${key}`, `module ${i + 1} ${key} must be a string (FORMAT.md §3)`);
    }
    for (const key of Object.keys(m)) {
      if (!MODULE_KEYS.includes(key)) out.push(finding("warning", "yaml-fields", "unbuilt.yaml", L(`modules[${i}].${key}`), `module ${i + 1} has unknown key ${key} (FORMAT.md §3)`));
    }
  });
  return out;
}

export function yamlEnums(ctx) {
  const out = [];
  const meta = ctx.meta;
  const L = (key) => ctx.yaml.lines.get(key);
  const err = (key, msg) => out.push(finding("error", "yaml-enums", "unbuilt.yaml", L(key), msg));
  if (isStr(meta.origin) && !ORIGINS.includes(meta.origin)) err("origin", `origin "${meta.origin}" is not one of ${ORIGINS.join(", ")} (FORMAT.md §3)`);
  if (Array.isArray(meta.modules)) {
    meta.modules.forEach((m, i) => {
      if (isMap(m) && isStr(m.maturity) && !MATURITIES.includes(m.maturity)) err(`modules[${i}].maturity`, `maturity "${m.maturity}" of module ${i + 1} is not one of ${MATURITIES.join(", ")} (FORMAT.md §3)`);
    });
  }
  if (isStr(meta.original_effort) && !EFFORTS.includes(meta.original_effort)) err("original_effort", `original_effort "${meta.original_effort}" is not one of ${EFFORTS.join(", ")} (FORMAT.md §3)`);
  if (isStr(meta.interview) && !INTERVIEWS.includes(meta.interview)) err("interview", `interview "${meta.interview}" is not one of ${INTERVIEWS.join(", ")} (FORMAT.md §3)`);
  return out;
}

export function moduleIds(ctx) {
  const out = [];
  const seen = new Set();
  for (const m of ctx.modules) {
    if (m.id === null) continue;
    const line = ctx.yaml.lines.get(`modules[${m.index}].id`);
    const err = (msg) => out.push(finding("error", "module-ids", "unbuilt.yaml", line, msg));
    if (!/^[A-Z]{2,8}$/.test(m.id)) err(`module id "${m.id}" must match ^[A-Z]{2,8}$ (FORMAT.md §5)`);
    else if (m.id === "INV") err("module id INV is reserved for invariants (FORMAT.md §5)");
    else if (seen.has(m.id)) err(`module id ${m.id} is declared twice (FORMAT.md §5)`);
    seen.add(m.id);
  }
  return out;
}

export function modulePaths(ctx) {
  const out = [];
  const seen = new Set();
  for (const m of ctx.modules) {
    if (m.dir === null) continue;
    const line = ctx.yaml.lines.get(`modules[${m.index}].path`);
    const err = (msg) => out.push(finding("error", "module-paths", "unbuilt.yaml", line, msg));
    const label = m.id ?? m.index + 1;
    if (!m.dir.startsWith("modules/") || m.dir.split("/").includes("..")) err(`module ${label} path "${m.path}" must start with modules/ and contain no .. segment (FORMAT.md §3)`);
    else if (seen.has(m.dir)) err(`module path ${m.dir} is used by two modules (FORMAT.md §3)`);
    else if (!ctx.dirs.has(m.dir)) err(`module ${label} path ${m.dir} is not a directory (FORMAT.md §3)`);
    seen.add(m.dir);
  }
  for (const d of [...ctx.dirs].sort()) {
    if (/^modules\/[^/]+$/.test(d) && !seen.has(d)) out.push(finding("warning", "module-paths", d, null, `${d} is not declared in unbuilt.yaml (FORMAT.md §3)`));
  }
  return out;
}

const attemptId = (a) => {
  const m = /\*\*([A-Za-z]{2,8})-(\d+)\*\*/.exec(a.raw);
  return m ? `${m[1]}-${m[2]}` : `${a.prefix}-${a.num}`;
};

export function idFormat(ctx) {
  const out = [];
  for (const a of ctx.attempts) {
    if (a.retiredShaped && !a.exact?.retired) continue;
    const err = (msg) => out.push(finding("error", "id-format", a.file, a.line, msg));
    if (a.indented || a.bullet !== "-") {
      err(`${attemptId(a)}: declarations are top-level \`- \` bullets (FORMAT.md §5)`);
    } else if (a.exact === null) {
      err(`declaration of ${attemptId(a)} must match "- **ID-n** (MUST|SHOULD|MAY) text" or "- **ID-n** retired: reason" (FORMAT.md §5)`);
    } else {
      const expected = a.file === "SPEC.md" ? ["INV"] : ctx.modules.filter((m) => m.id !== null && `${m.dir}/SPEC.md` === a.file).map((m) => m.id);
      if (!expected.includes(a.exact.prefix)) err(`${a.exact.id} is declared in ${a.file} but only ${expected.join(" or ")} ids are declared there (FORMAT.md §5)`);
    }
  }
  return out;
}

export function idUnique(ctx) {
  const out = [];
  const first = new Map();
  for (const d of ctx.declarations) {
    const prev = first.get(d.id);
    if (prev) out.push(finding("error", "id-unique", d.file, d.line, `${d.id} is already declared at ${prev.file}:${prev.line} (FORMAT.md §5)`));
    else first.set(d.id, d);
  }
  return out;
}

export function idRetiredForm(ctx) {
  const out = [];
  for (const a of ctx.attempts) {
    if (a.retiredShaped && !a.exact?.retired) {
      const id = attemptId(a);
      const msg = a.indented || a.bullet !== "-"
        ? `${id}: declarations are top-level \`- \` bullets (FORMAT.md §5)`
        : `retired ${id} must be written "- **${id}** retired: reason" with no modality (FORMAT.md §5)`;
      out.push(finding("error", "id-retired-form", a.file, a.line, msg));
    }
  }
  const retired = new Set(ctx.declarations.filter((d) => d.retired).map((d) => d.id));
  for (const file of ctx.scenarioFiles) {
    for (const c of ctx.citations.get(file) ?? []) {
      if (retired.has(c.id)) out.push(finding("error", "id-retired-form", file, c.line, `${c.id} is retired and must not be cited (FORMAT.md §5)`));
    }
  }
  return out;
}

export function scenarioCitesId(ctx) {
  const out = [];
  const declared = new Set(ctx.declarations.map((d) => d.id));
  const live = new Set(ctx.declarations.filter((d) => !d.retired).map((d) => d.id));
  for (const file of ctx.scenarioFiles) {
    const sections = ctx.scenarios.filter((s) => s.file === file);
    if (sections.length === 0) out.push(finding("warning", "scenario-cites-id", file, null, `${file} has no scenario sections (FORMAT.md §3)`));
    for (const s of sections) {
      if (!s.citations.some((c) => live.has(c.id))) out.push(finding("error", "scenario-cites-id", file, s.startLine, `scenario "${s.title}" cites no declared requirement id (FORMAT.md §3)`));
    }
    for (const c of ctx.citations.get(file) ?? []) {
      if (!declared.has(c.id)) out.push(finding("error", "scenario-cites-id", file, c.line, `${c.id} is cited but not declared (FORMAT.md §5)`));
    }
  }
  return out;
}

function coverage(ctx, modality, level, rule) {
  const covered = new Set(ctx.scenarios.flatMap((s) => s.citations.map((c) => c.id)));
  return ctx.declarations.filter((d) => !d.retired && d.modality === modality && !covered.has(d.id))
    .map((d) => finding(level, rule, d.file, d.line, `${d.id} is a ${modality} but no scenario cites it (FORMAT.md §5)`));
}

export const mustHasScenario = (ctx) => coverage(ctx, "MUST", "error", "must-has-scenario");
export const shouldHasScenario = (ctx) => coverage(ctx, "SHOULD", "warning", "should-has-scenario");

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SUBSTITUTIONS_README = "substitutions/README.md";

function substitutionNames(ctx) {
  const subs = ctx.meta.substitutions;
  return Array.isArray(subs) && subs.every(isStr) ? subs : null;
}

export function substitutionFiles(ctx) {
  const out = [];
  const subs = substitutionNames(ctx) ?? [];
  const L = (i) => ctx.yaml.lines.get(`substitutions[${i}]`);
  const seen = new Set();
  subs.forEach((name, i) => {
    if (!KEBAB_RE.test(name)) {
      out.push(finding("error", "substitution-files", "unbuilt.yaml", L(i), `substitution name "${name}" must be kebab-case (FORMAT.md §4)`));
      return;
    }
    if (seen.has(name)) {
      out.push(finding("error", "substitution-files", "unbuilt.yaml", L(i), `substitution ${name} is listed twice (FORMAT.md §4)`));
      return;
    }
    seen.add(name);
    const file = `substitutions/${name}.md`;
    if (!ctx.files.has(file)) out.push(finding("error", "substitution-files", file, null, `substitution ${name} has no file ${file} (FORMAT.md §4)`));
  });
  if (subs.length > 0 && !ctx.files.has(SUBSTITUTIONS_README)) {
    out.push(finding("error", "substitution-files", SUBSTITUTIONS_README, null, "substitutions/README.md is required when substitutions is non-empty (FORMAT.md §4)"));
  }
  for (const p of [...ctx.files.keys()].sort()) {
    const m = /^substitutions\/([^/]+)\.md$/.exec(p);
    if (m && p !== SUBSTITUTIONS_README && !seen.has(m[1])) out.push(finding("warning", "substitution-files", p, null, `${p} is not listed in substitutions (FORMAT.md §4)`));
  }
  return out;
}

const tableCells = (line) => {
  const cells = line.split("|").map((c) => c.trim());
  cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
};

function findModuleTable(lines) {
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("|")) { i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].startsWith("|")) j++;
    if (tableCells(lines[i])[0] === "Module") return { start: i, rows: lines.slice(i, j) };
    i = j;
  }
  return null;
}

export function substitutionMatrix(ctx) {
  const subs = substitutionNames(ctx);
  if (subs === null || subs.length === 0 || !ctx.prose.has(SUBSTITUTIONS_README)) return [];
  const out = [];
  const err = (line, msg) => out.push(finding("error", "substitution-matrix", SUBSTITUTIONS_README, line, msg));
  const table = findModuleTable(ctx.prose.get(SUBSTITUTIONS_README).split("\n"));
  if (table === null) {
    err(null, "no table whose header starts with Module was found (FORMAT.md §4)");
    return out;
  }
  const headerLine = table.start + 1;
  const columns = tableCells(table.rows[0]).slice(1);
  const declared = new Set(subs);
  for (const c of columns) if (!declared.has(c)) err(headerLine, `matrix column "${c}" is not a declared substitution (FORMAT.md §4)`);
  for (const s of [...declared]) if (!columns.includes(s)) err(headerLine, `matrix is missing column ${s} (FORMAT.md §4)`);
  const ids = new Set(ctx.moduleIds);
  const rowIds = new Set();
  table.rows.slice(2).forEach((row, k) => {
    const cells = tableCells(row);
    const id = cells[0] ?? "";
    const line = table.start + 3 + k;
    rowIds.add(id);
    if (!ids.has(id)) err(line, `matrix row "${id}" is not a declared module id (FORMAT.md §4)`);
    columns.forEach((c, j) => {
      const v = cells[j + 1] ?? "";
      if (!["required", "optional", "-"].includes(v)) err(line, `matrix cell "${v}" for ${id}/${c} must be required, optional or - (FORMAT.md §4)`);
    });
  });
  for (const id of ids) if (!rowIds.has(id)) err(headerLine, `matrix is missing row ${id} (FORMAT.md §4)`);
  return out;
}

const EVIDENCE_NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

export function evidenceDates(ctx) {
  const out = [];
  for (const p of [...ctx.files.keys()].sort()) {
    const m = /^evidence\/([^/]+\.md)$/.exec(p);
    if (!m) continue;
    const err = (line, msg) => out.push(finding("error", "evidence-dates", p, line, msg));
    if (!EVIDENCE_NAME_RE.test(m[1])) err(null, `evidence file name "${m[1]}" must be YYYY-MM-DD-slug.md (FORMAT.md §4)`);
    if (!ctx.texts.has(p)) continue;
    const lines = ctx.texts.get(p).split("\n").map((l) => l.replace(/\r$/, ""));
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i < lines.length && /^# /.test(lines[i])) i++;
    const found = {};
    let seen = 0;
    for (; i < lines.length && seen < 2; i++) {
      if (lines[i].trim() === "") continue;
      seen++;
      const k = /^(Checked|Expires):(.*)$/.exec(lines[i]);
      if (k && !(k[1] in found)) found[k[1]] = { value: k[2].trim(), line: i + 1 };
    }
    for (const key of ["Checked", "Expires"]) if (!(key in found)) err(null, `${key}: line is missing (FORMAT.md §4)`);
    const valid = {};
    for (const key of ["Checked", "Expires"]) {
      const f = found[key];
      if (!f) continue;
      if (isCalendarDate(f.value)) valid[key] = f;
      else err(f.line, `${key}: ${f.value} is not a calendar date (FORMAT.md §4)`);
    }
    if (valid.Checked && valid.Expires) {
      const c = valid.Checked.value;
      const e = valid.Expires.value;
      if (e < c) err(valid.Expires.line, `Expires: ${e} is before Checked: ${c} (FORMAT.md §4)`);
    }
    if (valid.Expires && valid.Expires.value < ctx.today) {
      out.push(finding("warning", "evidence-dates", p, valid.Expires.line, `expired on ${valid.Expires.value}; re-check before relying on it (FORMAT.md §4)`));
    }
  }
  return out;
}

export function redactionRequired(ctx) {
  if (ctx.meta.origin !== ORIGINS[1] || ctx.files.has("redaction.md")) return [];
  return [finding("error", "redaction-required", "redaction.md", null, "redaction.md is required when origin is extracted-from-private-implementation (FORMAT.md §3)")];
}

export function designRequired(ctx) {
  if (ctx.meta.has_ui !== true || ctx.files.has("design/README.md")) return [];
  return [finding("error", "design-required", "design/README.md", null, "design/README.md is required when has_ui is true (FORMAT.md §3)")];
}

function scanInstance(ctx, patterns) {
  const opts = { allowHosts: ctx.allowHosts, exactHosts: ctx.exactHosts };
  const out = [];
  const keep = (file, hits, withLine) => {
    for (const h of hits) {
      if (!patterns.includes(h.pattern)) continue;
      out.push({ file, line: withLine ? h.line : null, match: h.match, pattern: h.pattern, kind: h.kind });
    }
  };
  for (const [file, text] of ctx.texts) keep(file, scanText(text, opts), true);
  for (const [file, img] of ctx.images) {
    if (img.format === null) continue;
    for (const seg of img.segments) keep(file, scanText(seg, opts), false);
  }
  return out;
}

const leakRule = (rule, patterns, describe) => (ctx) =>
  scanInstance(ctx, patterns).map((h) => finding("error", rule, h.file, h.line, describe(maskMatch(h.match), h)));

const IP_TAIL = "replace it with a role word or, if public, add it to public_hosts (FORMAT.md §7)";
export const leakEmail = leakRule("leak-email", ["email"], (m) => `email address ${m} found; replace it with a role word (FORMAT.md §7)`);
export const leakIpv4 = leakRule("leak-ipv4", ["ipv4", "ipv6"], (m, h) => {
  if (h.kind === "mac") return `MAC address ${m} found; replace it with a role word (FORMAT.md §7)`;
  return `${h.pattern === "ipv4" ? "IPv4" : "IPv6"} address ${m} found; ${IP_TAIL}`;
});
export const leakHostname = leakRule("leak-hostname", ["hostname"], (m) => `hostname ${m} found; ${IP_TAIL}`);
export const leakHomePath = leakRule("leak-home-path", ["home-path"], (m) => `home path ${m} found; replace it with a role word (FORMAT.md §7)`);
export const leakSecret = leakRule("leak-secret", ["secret"], (m) => `secret-shaped value ${m} found; remove it (FORMAT.md §7)`);

const MAX_MD_LINES = 1500;
const MAX_MD_WORDS = 60000;
const MAX_IMAGE_BYTES = 2097152;
const MAX_MODULES = 12;
const ALLOWED_IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "svg"];
const REJECTED_IMAGE_EXTS = ["gif", "bmp", "tif", "tiff", "heic", "ico", "avif"];
const IMAGE_EXTS = [...ALLOWED_IMAGE_EXTS, ...REJECTED_IMAGE_EXTS];

export function budgetFileLines(ctx) {
  const out = [];
  for (const e of ctx.entries) {
    if (e.kind !== "file") continue;
    if (e.isText && e.tooLarge) {
      out.push(finding("error", "budget-file-lines", e.path, null, `${e.path} is too large to scan (over 5 MB) (FORMAT.md §8)`));
      continue;
    }
    if (e.ext !== "md" || !ctx.texts.has(e.path)) continue;
    const n = countLines(ctx.texts.get(e.path));
    if (n > MAX_MD_LINES) out.push(finding("error", "budget-file-lines", e.path, null, `${e.path} has ${n} lines; the limit is ${MAX_MD_LINES} (FORMAT.md §8)`));
  }
  return out;
}

export function budgetTotalWords(ctx) {
  let n = 0;
  for (const [p, text] of ctx.texts) if (ctx.files.get(p)?.ext === "md") n += countWords(text);
  if (n <= MAX_MD_WORDS) return [];
  return [finding("error", "budget-total-words", ".", null, `instance has ${n} words of Markdown; the limit is ${MAX_MD_WORDS} (FORMAT.md §8)`)];
}

export function budgetImage(ctx) {
  const out = [];
  for (const e of ctx.entries) {
    if (e.kind !== "file" || !IMAGE_EXTS.includes(e.ext)) continue;
    if (e.size > MAX_IMAGE_BYTES) out.push(finding("error", "budget-image", e.path, null, `${e.path} is ${e.size} bytes; the limit is ${MAX_IMAGE_BYTES} (FORMAT.md §8)`));
    if (!ALLOWED_IMAGE_EXTS.includes(e.ext)) out.push(finding("error", "budget-image", e.path, null, `${e.path} has type ${e.ext}; allowed image types are ${ALLOWED_IMAGE_EXTS.join(", ")} (FORMAT.md §8)`));
  }
  return out;
}

export function budgetModuleCount(ctx) {
  const n = ctx.modules.length;
  if (n <= MAX_MODULES) return [];
  return [finding("error", "budget-module-count", ".", null, `${n} modules are declared; the limit is ${MAX_MODULES} (FORMAT.md §8)`)];
}

const SPECIAL_KINDS = { symlink: "symbolic link", fifo: "FIFO", socket: "socket", device: "device" };
const FORMAT_OF_EXT = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp" };

export function fileTypes(ctx) {
  const out = [];
  const err = (p, msg) => out.push(finding("error", "file-types", p, null, `${msg} (FORMAT.md §7)`));
  for (const e of ctx.entries) {
    if (Object.hasOwn(SPECIAL_KINDS, e.kind)) {
      err(e.path, `${e.path} is a ${SPECIAL_KINDS[e.kind]}; links and special files cannot be scanned`);
      continue;
    }
    if (e.kind === "unreadable") {
      err(e.path, `${e.path} cannot be read`);
      continue;
    }
    if (e.kind !== "file") continue;
    // An .svg is scanned as text, so a non-text .svg cannot be scanned (spec amendment 5).
    if (!e.isText && (!IMAGE_EXTS.includes(e.ext) || e.ext === "svg")) {
      err(e.path, `${e.path} is not a text file or an allowed image`);
      continue;
    }
    const img = ctx.images.get(e.path);
    if (!img) continue;
    let reason = img.error;
    if (reason === null && img.format !== FORMAT_OF_EXT[e.ext]) reason = `${img.format} content with a ${e.ext} extension`;
    if (reason !== null) err(e.path, `${e.path}: image cannot be parsed for metadata scanning (${reason})`);
  }
  for (const d of ctx.nodeModulesDirs) err(d, `${d} is a node_modules directory`);
  return out;
}

RULES.push(
  { name: "required-files", fn: requiredFiles, needsMeta: false },
  { name: "module-files", fn: moduleFiles, needsMeta: true },
  { name: "yaml-parse", fn: yamlParse, needsMeta: false },
  { name: "yaml-fields", fn: yamlFields, needsMeta: true },
  { name: "yaml-enums", fn: yamlEnums, needsMeta: true },
  { name: "module-ids", fn: moduleIds, needsMeta: true },
  { name: "module-paths", fn: modulePaths, needsMeta: true },
  { name: "id-format", fn: idFormat, needsMeta: true },
  { name: "id-unique", fn: idUnique, needsMeta: true },
  { name: "id-retired-form", fn: idRetiredForm, needsMeta: true },
  { name: "scenario-cites-id", fn: scenarioCitesId, needsMeta: true },
  { name: "must-has-scenario", fn: mustHasScenario, needsMeta: true },
  { name: "should-has-scenario", fn: shouldHasScenario, needsMeta: true },
  { name: "substitution-files", fn: substitutionFiles, needsMeta: true },
  { name: "substitution-matrix", fn: substitutionMatrix, needsMeta: true },
  { name: "evidence-dates", fn: evidenceDates, needsMeta: false },
  { name: "redaction-required", fn: redactionRequired, needsMeta: true },
  { name: "design-required", fn: designRequired, needsMeta: true },
  { name: "leak-email", fn: leakEmail, needsMeta: false },
  { name: "leak-ipv4", fn: leakIpv4, needsMeta: false },
  { name: "leak-hostname", fn: leakHostname, needsMeta: false },
  { name: "leak-home-path", fn: leakHomePath, needsMeta: false },
  { name: "leak-secret", fn: leakSecret, needsMeta: false },
  { name: "budget-file-lines", fn: budgetFileLines, needsMeta: false },
  { name: "budget-total-words", fn: budgetTotalWords, needsMeta: false },
  { name: "budget-image", fn: budgetImage, needsMeta: false },
  { name: "budget-module-count", fn: budgetModuleCount, needsMeta: true },
  { name: "file-types", fn: fileTypes, needsMeta: false },
);

export function isCalendarDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
