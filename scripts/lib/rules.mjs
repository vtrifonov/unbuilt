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

RULES.push(
  { name: "required-files", fn: requiredFiles, needsMeta: false },
  { name: "module-files", fn: moduleFiles, needsMeta: true },
  { name: "yaml-parse", fn: yamlParse, needsMeta: false },
);

export function isCalendarDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
