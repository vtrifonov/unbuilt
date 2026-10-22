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

function requiredFiles(ctx) {
  return REQUIRED_FILES.filter((name) => !ctx.files.has(name))
    .map((name) => finding("error", "required-files", name, null, `required file ${name} is missing (FORMAT.md §3)`));
}

function moduleFiles(ctx) {
  const out = [];
  for (const m of ctx.modules) {
    if (typeof m.dir !== "string" || !ctx.dirs.has(m.dir)) continue;
    for (const name of MODULE_FILES) {
      if (!ctx.files.has(`${m.dir}/${name}`)) out.push(finding("error", "module-files", `${m.dir}/${name}`, null, `module ${m.id ?? m.index + 1} is missing ${name} (FORMAT.md §3)`));
    }
  }
  return out;
}

function yamlParse(ctx) {
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

function yamlFields(ctx) {
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

function yamlEnums(ctx) {
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

function moduleIds(ctx) {
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

function modulePaths(ctx) {
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

function idFormat(ctx) {
  const out = [];
  for (const a of ctx.attempts) {
    if (a.retiredShaped) continue;
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

function idUnique(ctx) {
  const out = [];
  const first = new Map();
  for (const d of ctx.declarations) {
    const prev = first.get(d.id);
    if (prev) out.push(finding("error", "id-unique", d.file, d.line, `${d.id} is already declared at ${prev.file}:${prev.line} (FORMAT.md §5)`));
    else first.set(d.id, d);
  }
  return out;
}

function idRetiredForm(ctx) {
  const out = [];
  for (const a of ctx.attempts) {
    if (a.retiredShaped && !a.exact?.retired) {
      const id = attemptId(a);
      out.push(finding("error", "id-retired-form", a.file, a.line, `retired ${id} must be written "- **${id}** retired: reason" with no modality (FORMAT.md §5)`));
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

function scenarioCitesId(ctx) {
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

const mustHasScenario = (ctx) => coverage(ctx, "MUST", "error", "must-has-scenario");
const shouldHasScenario = (ctx) => coverage(ctx, "SHOULD", "warning", "should-has-scenario");

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
);

export function isCalendarDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
