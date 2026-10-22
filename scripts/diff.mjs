import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitize, JSON_ESCAPE_RE, InstanceError, scanInstance, readIncludedFile, writeError } from "./snapshot.mjs";
import { parse } from "./lib/yaml-subset.mjs";
import { blankCommentsAndFences, findAttempts, findCitations, findScenarioSections } from "./lib/markdown.mjs";

export const USAGE = "usage: node scripts/diff.mjs <old-dir> <new-dir> [--json]\n       node scripts/diff.mjs --help\n";

const LISTS = {
  requirements: ["added", "changed", "modality", "inferred", "retired", "removed"],
  scenarios: ["added", "removed", "changed"],
  modules: ["added", "removed", "maturity"],
  substitutions: ["added", "removed", "changed"],
  milestones: ["added", "removed", "changed"],
  files: ["changed", "added", "removed"],
};

export function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };
  const flag = argv.find((a) => a.startsWith("--") && a !== "--json");
  if (flag !== undefined) return { usageError: `unknown flag: ${flag}` };
  const dirs = argv.filter((a) => a !== "--json");
  if (dirs.length !== 2) return { usageError: "expected exactly two directories: <old-dir> <new-dir>" };
  return { oldDir: dirs[0], newDir: dirs[1], json: argv.includes("--json") };
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function stripTrailingSlashes(raw) {
  let e = raw.length;
  while (e > 0 && raw.charCodeAt(e - 1) === 47) e--;
  return raw.slice(0, e);
}

function trimmedEnd(lines, start, end) {
  let e = end;
  while (e > start && /^[ \t]*$/.test(lines[e - 1])) e--;
  return e;
}

export function modulePath(raw, dirs) {
  if (typeof raw !== "string") return null;
  const p = stripTrailingSlashes(raw);
  if (p === "" || p.startsWith("/") || path.isAbsolute(p)) return null;
  if (p.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  return dirs.has(p) ? p : null;
}

function loadSide(root, side) {
  try {
    const { included, skipped, dirs } = scanInstance(root);
    const decoder = new TextDecoder("utf-8");
    const text = new Map();
    for (const entry of included) {
      const raw = decoder.decode(readIncludedFile(root, entry.path));
      text.set(entry.path, raw.replace(/^\ufeff/, "").replace(/\r\n/g, "\n"));
    }
    if (!text.has("unbuilt.yaml")) {
      throw new InstanceError(`unbuilt.yaml: ${dirs.has("unbuilt.yaml") || skipped.some((s) => s.path === "unbuilt.yaml") ? "not a regular file" : "missing"}`);
    }
    const { value: meta, errors } = parse(text.get("unbuilt.yaml"));
    if (errors.length > 0) throw new InstanceError(`unbuilt.yaml: ${sanitize(errors[0].message)}`);
    const modules = [];
    const seen = new Set();
    if (isObject(meta) && Array.isArray(meta.modules)) {
      for (const item of meta.modules) {
        if (!isObject(item) || typeof item.id !== "string" || seen.has(item.id)) continue;
        seen.add(item.id);
        modules.push({ id: item.id, path: modulePath(item.path, dirs), rawPath: item.path, maturity: item.maturity });
      }
    }
    const substitutions = isObject(meta) && Array.isArray(meta.substitutions) ? meta.substitutions.filter((s) => typeof s === "string") : [];
    return { meta: isObject(meta) ? meta : null, text, dirs, modules, substitutions, prefixes: [...modules.map((m) => m.id), "INV"] };
  } catch (e) {
    if (e instanceof InstanceError) e.message = `${side}: ${e.message}`;
    throw e;
  }
}

export function compareIds(a, b) {
  const [pa, na] = a.split("-");
  const [pb, nb] = b.split("-");
  if (pa !== pb) return pa < pb ? -1 : 1;
  return Number(na) - Number(nb);
}

export function declarations(side) {
  const byId = new Map();
  const lines = new Map();
  const files = ["SPEC.md", ...side.modules.filter((m) => typeof m.path === "string").map((m) => `${m.path}/SPEC.md`)];
  for (const file of files) {
    if (!side.text.has(file) || lines.has(file)) continue;
    const set = new Set();
    lines.set(file, set);
    for (const a of findAttempts(blankCommentsAndFences(side.text.get(file)), side.prefixes)) {
      if (a.exact === null) continue;
      set.add(a.line);
      const { id, retired, modality, inferred, text } = a.exact;
      if (byId.has(id)) continue;
      byId.set(id, { retired, modality, inferred, text: retired ? text.trimEnd() : text.replace(/^\(inferred\) /, "").trimEnd(), file, line: a.line });
    }
  }
  return { byId, lines };
}

function compareRequirements(oldDecl, newDecl, out) {
  for (const [id, o] of oldDecl.byId) {
    const n = newDecl.byId.get(id);
    if (!n) out.removed.push({ id, old_file: o.file });
    else if (!o.retired && n.retired) out.retired.push({ id, file: n.file, line: n.line });
    else if (o.retired && !n.retired) out.added.push({ id, modality: n.modality, inferred: n.inferred, file: n.file, line: n.line });
    else if (!o.retired) {
      if (o.text !== n.text) out.changed.push({ id, file: n.file, line: n.line, old_line: o.line });
      if (o.modality !== n.modality) out.modality.push({ id, from: o.modality, to: n.modality });
      if (o.inferred !== n.inferred) out.inferred.push({ id, from: o.inferred, to: n.inferred });
    }
  }
  for (const [id, n] of newDecl.byId) {
    if (!oldDecl.byId.has(id) && !n.retired) out.added.push({ id, modality: n.modality, inferred: n.inferred, file: n.file, line: n.line });
  }
  for (const list of Object.values(out)) list.sort((a, b) => compareIds(a.id, b.id));
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function scenarios(side) {
  const preamble = new Map();
  const parsed = new Map();
  const groupSections = (sections) => {
    const groups = new Map();
    const citeSets = new Map();
    for (const s of sections) {
      let g = groups.get(s.title);
      if (!g) {
        g = { title: s.title, bodies: [], cites: [] };
        groups.set(s.title, g);
        citeSets.set(g, new Set());
      }
      g.bodies.push(s.body);
      for (const id of s.cites) citeSets.get(g).add(id);
    }
    for (const [g, set] of citeSets) g.cites = [...set].sort(compareIds);
    return groups;
  };
  const load = (file) => {
    if (parsed.has(file)) return parsed.get(file);
    const raw = side.text.get(file).split("\n");
    const blanked = blankCommentsAndFences(side.text.get(file)).split("\n");
    const found = findScenarioSections(blanked.join("\n"));
    preamble.set(file, raw.slice(0, found.length > 0 ? found[0].startLine - 1 : raw.length).join("\n"));
    const sections = found.map((s) => ({ title: s.title, body: raw.slice(s.startLine, trimmedEnd(raw, s.startLine, s.endLine)).join("\n"), cites: findCitations(blanked.slice(s.startLine, s.endLine).join("\n"), side.prefixes).map((c) => c.id) }));
    parsed.set(file, { sections, groups: groupSections(sections) });
    return parsed.get(file);
  };
  const files = new Map();
  for (const m of side.modules) {
    const file = m.path === null ? null : `${m.path}/scenarios.md`;
    if (file === null || !side.text.has(file)) continue;
    const key = String(m.id);
    if (!files.has(key)) files.set(key, { module: m.id, files: [] });
    files.get(key).files.push(file);
  }
  const merged = new Map();
  const byModule = new Map();
  for (const [key, { module, files: list }] of files) {
    if (list.length === 1) {
      byModule.set(key, { module, groups: load(list[0]).groups });
      continue;
    }
    const joined = list.join("\u0000");
    if (!merged.has(joined)) merged.set(joined, groupSections(list.flatMap((f) => load(f).sections)));
    byModule.set(key, { module, groups: merged.get(joined) });
  }
  return { byModule, preamble };
}

const NO_GROUPS = new Map();

function compareScenarios(oldS, newS, out) {
  const pairs = new Map();
  const diffGroups = (og, ng) => {
    if (!pairs.has(og)) pairs.set(og, new Map());
    const cache = pairs.get(og);
    if (cache.has(ng)) return cache.get(ng);
    const res = { removed: [], changed: [], added: [] };
    for (const [title, o] of og) {
      const n = ng.get(title);
      if (!n) res.removed.push(o);
      else if (JSON.stringify(o.bodies) !== JSON.stringify(n.bodies)) res.changed.push(n);
    }
    for (const [title, n] of ng) if (!og.has(title)) res.added.push(n);
    cache.set(ng, res);
    return res;
  };
  const emit = (module, res) => {
    for (const k of Object.keys(res)) for (const g of res[k]) out[k].push({ module, title: g.title, cites: g.cites });
  };
  for (const [key, o] of oldS.byModule) emit(o.module, diffGroups(o.groups, newS.byModule.get(key)?.groups ?? NO_GROUPS));
  for (const [key, n] of newS.byModule) if (!oldS.byModule.has(key)) emit(n.module, diffGroups(NO_GROUPS, n.groups));
  for (const list of Object.values(out)) list.sort((a, b) => byCodeUnit(a.module, b.module) || byCodeUnit(a.title, b.title));
}

function compareModules(oldSide, newSide, out) {
  const oldBy = new Map(oldSide.modules.map((m) => [m.id, m]));
  const newBy = new Map(newSide.modules.map((m) => [m.id, m]));
  for (const [id, o] of oldBy) {
    const n = newBy.get(id);
    if (!n) out.removed.push({ id });
    else if (JSON.stringify(o.maturity) !== JSON.stringify(n.maturity)) out.maturity.push({ id, from: o.maturity ?? null, to: n.maturity ?? null });
  }
  for (const [id, n] of newBy) if (!oldBy.has(id)) out.added.push({ id, maturity: n.maturity ?? null });
  for (const list of Object.values(out)) list.sort((a, b) => byCodeUnit(a.id, b.id));
}

function compareSubstitutions(oldSide, newSide, out) {
  const oldSet = new Set(oldSide.substitutions);
  const newSet = new Set(newSide.substitutions);
  for (const n of oldSet) {
    if (!newSet.has(n)) out.removed.push(n);
    else if (oldSide.text.get(`substitutions/${n}.md`) !== newSide.text.get(`substitutions/${n}.md`)) out.changed.push(n);
  }
  for (const n of newSet) if (!oldSet.has(n)) out.added.push(n);
  for (const list of Object.values(out)) list.sort(byCodeUnit);
}

export function milestones(side) {
  const byNumber = new Map();
  const claimed = new Set();
  const raw = (side.text.get("BUILD.md") ?? "").split("\n");
  const blanked = blankCommentsAndFences(side.text.get("BUILD.md") ?? "").split("\n");
  for (let i = 0; i < blanked.length; i++) {
    const m = /^## Milestone ([1-9][0-9]*): (.+)$/.exec(blanked[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < blanked.length && !/^## /.test(blanked[end])) end++;
    const number = Number(m[1]);
    if (!byNumber.has(number)) {
      const coversLine = blanked.slice(i + 1, end).find((l) => /^Covers:/.test(l)) ?? "";
      const covers = [...new Set(findCitations(coversLine, side.prefixes).map((c) => c.id))].sort(compareIds);
      byNumber.set(number, { title: m[2], covers, raw: raw.slice(i, trimmedEnd(raw, i, end)).join("\n") });
      for (let k = i; k < end; k++) claimed.add(k);
    }
    i = end - 1;
  }
  return { byNumber, claimed };
}

function compareMilestones(oldS, newS, out) {
  for (const [number, o] of oldS.byNumber) {
    const n = newS.byNumber.get(number);
    if (!n) out.removed.push({ number, title: o.title });
    else if (o.raw !== n.raw) {
      const [oc, nc] = [new Set(o.covers), new Set(n.covers)];
      const entry = { number, covers_added: n.covers.filter((c) => !oc.has(c)), covers_removed: o.covers.filter((c) => !nc.has(c)), title_changed: o.title !== n.title };
      Object.defineProperty(entry, "title", { value: n.title, enumerable: false });
      out.changed.push(entry);
    }
  }
  for (const [number, n] of newS.byNumber) if (!oldS.byNumber.has(number)) out.added.push({ number, title: n.title });
  for (const list of Object.values(out)) list.sort((a, b) => a.number - b.number);
}

function withoutLines(text, drop, offset) {
  return text.split("\n").filter((_, i) => !drop.has(i + offset)).join("\n");
}

function compareFiles(o, n, ctx, out) {
  const oldBy = new Map(o.modules.map((m) => [m.id, m]));
  const newBy = new Map(n.modules.map((m) => [m.id, m]));
  const dirPrefixes = [];
  for (const [side, other] of [[o, newBy], [n, oldBy]]) {
    for (const m of side.modules) if (m.path !== null && !other.has(m.id)) dirPrefixes.push(`${m.path}/`);
  }
  const dirPrefixSet = new Set(dirPrefixes);
  const underAdded = (p) => {
    for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1)) if (dirPrefixSet.has(p.slice(0, i + 1))) return true;
    return false;
  };
  const subs = new Set([...o.substitutions, ...n.substitutions].map((s) => `substitutions/${s}.md`));
  const accountedOn = (side, otherBy) => {
    const set = new Set(["SPEC.md", "BUILD.md", "unbuilt.yaml", ...subs]);
    for (const m of side.modules) {
      if (m.path === null) continue;
      set.add(`${m.path}/SPEC.md`);
      set.add(`${m.path}/scenarios.md`);
      if (otherBy.get(m.id)?.path != null) set.add(`${m.path}/problem.md`);
    }
    return (p) => set.has(p) || underAdded(p);
  };
  const oldAccounted = accountedOn(o, newBy);
  const newAccounted = accountedOn(n, oldBy);
  const none = new Set();
  const residual = (side, file, drop, offset) => (side.text.has(file) ? withoutLines(side.text.get(file), drop ?? none, offset) : null);
  const found = { changed: new Set(), added: new Set(), removed: new Set() };
  const compare = (oldPath, newPath, oldRes, newRes) => {
    if ((oldRes ?? "") === (newRes ?? "")) return;
    if (oldRes !== null && newRes !== null) found.changed.add(newPath);
    else if (newRes !== null) found.added.add(newPath);
    else found.removed.add(oldPath);
  };
  compare("SPEC.md", "SPEC.md", residual(o, "SPEC.md", ctx.oldDecl.lines.get("SPEC.md"), 1), residual(n, "SPEC.md", ctx.newDecl.lines.get("SPEC.md"), 1));
  compare("BUILD.md", "BUILD.md", residual(o, "BUILD.md", ctx.oldMs.claimed, 0), residual(n, "BUILD.md", ctx.newMs.claimed, 0));
  const donePairs = new Set();
  for (const [id, om] of oldBy) {
    const nm = newBy.get(id);
    if (!nm || om.path === null || nm.path === null) continue;
    const [op, np] = [`${om.path}/`, `${nm.path}/`];
    if (donePairs.has(`${op}\u0000${np}`)) continue;
    donePairs.add(`${op}\u0000${np}`);
    compare(`${op}SPEC.md`, `${np}SPEC.md`, residual(o, `${op}SPEC.md`, ctx.oldDecl.lines.get(`${op}SPEC.md`), 1), residual(n, `${np}SPEC.md`, ctx.newDecl.lines.get(`${np}SPEC.md`), 1));
    compare(`${op}scenarios.md`, `${np}scenarios.md`, ctx.oldScen.preamble.get(`${op}scenarios.md`) ?? null, ctx.newScen.preamble.get(`${np}scenarios.md`) ?? null);
    compare(`${op}problem.md`, `${np}problem.md`, residual(o, `${op}problem.md`, none, 0), residual(n, `${np}problem.md`, none, 0));
  }
  const rawPath = (m) => (typeof m.rawPath === "string" ? stripTrailingSlashes(m.rawPath) : JSON.stringify(m.rawPath));
  const keys = new Set([...Object.keys(o.meta ?? {}), ...Object.keys(n.meta ?? {})]);
  keys.delete("modules");
  keys.delete("substitutions");
  const metaChanged = [...keys].some((k) => JSON.stringify(o.meta?.[k]) !== JSON.stringify(n.meta?.[k]));
  if (metaChanged || [...oldBy].some(([id, m]) => newBy.has(id) && rawPath(m) !== rawPath(newBy.get(id)))) found.changed.add("unbuilt.yaml");
  const oldOnly = [...o.text.keys()].filter((p) => !oldAccounted(p));
  const newOnly = new Set([...n.text.keys()].filter((p) => !newAccounted(p)));
  for (const p of oldOnly) {
    if (!newOnly.has(p)) found.removed.add(p);
    else if (o.text.get(p) !== n.text.get(p)) found.changed.add(p);
  }
  const oldOnlySet = new Set(oldOnly);
  for (const p of newOnly) if (!oldOnlySet.has(p)) found.added.add(p);
  for (const k of Object.keys(found)) out[k] = [...found[k]].sort(byCodeUnit);
}

function emptyResult(oldMeta, newMeta) {
  const label = (m) => ({ name: typeof m?.name === "string" ? m.name : null, unbuilt: typeof m?.unbuilt === "number" ? m.unbuilt : null });
  const result = { changed: false, old: label(oldMeta), new: label(newMeta) };
  for (const [group, keys] of Object.entries(LISTS)) result[group] = Object.fromEntries(keys.map((k) => [k, []]));
  return result;
}

export function diffInstances(oldDir, newDir) {
  const oldSide = loadSide(path.resolve(oldDir), "old");
  const newSide = loadSide(path.resolve(newDir), "new");
  const result = emptyResult(oldSide.meta, newSide.meta);
  const ctx = { oldDecl: declarations(oldSide), newDecl: declarations(newSide), oldScen: scenarios(oldSide), newScen: scenarios(newSide), oldMs: milestones(oldSide), newMs: milestones(newSide) };
  compareRequirements(ctx.oldDecl, ctx.newDecl, result.requirements);
  compareScenarios(ctx.oldScen, ctx.newScen, result.scenarios);
  compareModules(oldSide, newSide, result.modules);
  compareSubstitutions(oldSide, newSide, result.substitutions);
  compareMilestones(ctx.oldMs, ctx.newMs, result.milestones);
  compareFiles(oldSide, newSide, ctx, result.files);
  result.changed = Object.keys(LISTS).some((g) => Object.values(result[g]).some((l) => l.length > 0));
  return result;
}

const at = (e) => `${e.id} ${e.file}:${e.line}`;
const shift = (e) => `${e.id} ${e.from} to ${e.to}`;
const titled = (e) => `${e.number} "${e.title}"`;
const state = (v) => (v ? "inferred" : "stated");
const FORMAT = {
  "requirements.added": (e) => `${e.id} ${e.modality}${e.inferred ? " inferred" : ""} ${e.file}:${e.line}`,
  "requirements.changed": at,
  "requirements.retired": at,
  "requirements.modality": shift,
  "modules.maturity": shift,
  "requirements.inferred": (e) => `${e.id} ${state(e.from)} to ${state(e.to)}`,
  "requirements.removed": (e) => `${e.id} ${e.old_file} (no retired line)`,
  "modules.added": (e) => `${e.id} ${e.maturity}`,
  "modules.removed": (e) => e.id,
  "milestones.added": titled,
  "milestones.removed": titled,
  "milestones.changed": (e) => {
    const covers = [...e.covers_added.map((c) => `+${c}`), ...e.covers_removed.map((c) => `-${c}`)];
    return titled(e) + (covers.length > 0 ? ` covers ${covers.join(" ")}` : "") + (e.title_changed ? " title changed" : "") + (covers.length === 0 && !e.title_changed ? " text changed" : "");
  },
};
const scenarioLine = (e) => `${e.module} "${e.title}"${e.cites.length > 0 ? ` cites ${e.cites.join(" ")}` : ""}`;

export function formatHuman(result) {
  if (!result.changed) return "no differences\n";
  const lines = [];
  for (const [group, keys] of Object.entries(LISTS)) {
    for (const key of keys) {
      const fmt = FORMAT[`${group}.${key}`] ?? (group === "scenarios" ? scenarioLine : String);
      for (const e of result[group][key]) lines.push(sanitize(`${group}.${key}  ${fmt(e)}`));
    }
  }
  return `${lines.join("\n")}\n${lines.length} difference(s)\n`;
}

export function formatJson(result) {
  const escape = (ch) => [...Array(ch.length).keys()].map((i) => "\\u" + ch.charCodeAt(i).toString(16).padStart(4, "0")).join("");
  return JSON.stringify(result, null, 2).replace(JSON_ESCAPE_RE, escape) + "\n";
}

function usageFail(message) {
  process.stderr.write(`${sanitize(message)}\n${USAGE}`);
  process.exitCode = 2;
}

function checkDir(dir) {
  let stat = null;
  try { stat = fs.statSync(dir); } catch { /* reported below */ }
  if (!stat) return `path does not exist: ${dir}`;
  if (!stat.isDirectory()) return `not a directory: ${dir}`;
  try { fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK); } catch { return `cannot read directory: ${dir}`; }
  return null;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(USAGE);
      return;
    }
    if (args.usageError) return usageFail(args.usageError);
    const bad = checkDir(args.oldDir) ?? checkDir(args.newDir);
    if (bad) return usageFail(bad);
    const result = diffInstances(args.oldDir, args.newDir);
    process.stdout.write(args.json ? formatJson(result) : formatHuman(result));
    process.exitCode = result.changed ? 1 : 0;
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
