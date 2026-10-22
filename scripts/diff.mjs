import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitize, InstanceError, scanInstance, readIncludedFile, writeError } from "./snapshot.mjs";
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

export function modulePath(raw, dirs) {
  if (typeof raw !== "string") return null;
  const p = raw.replace(/\/+$/, "");
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
      throw new InstanceError(`unbuilt.yaml: ${skipped.some((s) => s.path === "unbuilt.yaml") ? "not a regular file" : "missing"}`);
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
  const byKey = new Map();
  const preamble = new Map();
  for (const m of side.modules) {
    const file = m.path === null ? null : `${m.path}/scenarios.md`;
    if (file === null || !side.text.has(file)) continue;
    const raw = side.text.get(file).split("\n");
    const blanked = blankCommentsAndFences(side.text.get(file)).split("\n");
    const sections = findScenarioSections(blanked.join("\n"));
    preamble.set(file, raw.slice(0, sections.length > 0 ? sections[0].startLine - 1 : raw.length).join("\n"));
    for (const s of sections) {
      let lines = raw.slice(s.startLine, s.endLine);
      while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
      const cites = findCitations(blanked.slice(s.startLine, s.endLine).join("\n"), side.prefixes).map((c) => c.id);
      const key = `${m.id}\u0000${s.title}`;
      const entry = byKey.get(key) ?? { module: m.id, title: s.title, bodies: [], cites: [] };
      entry.bodies.push(lines.join("\n"));
      entry.cites = [...new Set([...entry.cites, ...cites])].sort(compareIds);
      byKey.set(key, entry);
    }
  }
  return { byKey, preamble };
}

function compareScenarios(oldS, newS, out) {
  const item = (e) => ({ module: e.module, title: e.title, cites: e.cites });
  for (const [key, o] of oldS.byKey) {
    const n = newS.byKey.get(key);
    if (!n) out.removed.push(item(o));
    else if (JSON.stringify(o.bodies) !== JSON.stringify(n.bodies)) out.changed.push(item(n));
  }
  for (const [key, n] of newS.byKey) if (!oldS.byKey.has(key)) out.added.push(item(n));
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
      let lines = raw.slice(i, end);
      while (lines.length > 0 && /^[ \t]*$/.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
      byNumber.set(number, { title: m[2], covers, raw: lines.join("\n") });
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
      const entry = { number, covers_added: n.covers.filter((c) => !o.covers.includes(c)), covers_removed: o.covers.filter((c) => !n.covers.includes(c)), title_changed: o.title !== n.title };
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
  const subs = new Set([...o.substitutions, ...n.substitutions].map((s) => `substitutions/${s}.md`));
  const accountedOn = (side, otherBy) => {
    const set = new Set(["SPEC.md", "BUILD.md", "unbuilt.yaml", ...subs]);
    for (const m of side.modules) {
      if (m.path === null) continue;
      set.add(`${m.path}/SPEC.md`);
      set.add(`${m.path}/scenarios.md`);
      if (otherBy.get(m.id)?.path != null) set.add(`${m.path}/problem.md`);
    }
    return (p) => set.has(p) || dirPrefixes.some((x) => p.startsWith(x));
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
  for (const [id, om] of oldBy) {
    const nm = newBy.get(id);
    if (!nm || om.path === null || nm.path === null) continue;
    const [op, np] = [`${om.path}/`, `${nm.path}/`];
    compare(`${op}SPEC.md`, `${np}SPEC.md`, residual(o, `${op}SPEC.md`, ctx.oldDecl.lines.get(`${op}SPEC.md`), 1), residual(n, `${np}SPEC.md`, ctx.newDecl.lines.get(`${np}SPEC.md`), 1));
    compare(`${op}scenarios.md`, `${np}scenarios.md`, ctx.oldScen.preamble.get(`${op}scenarios.md`) ?? null, ctx.newScen.preamble.get(`${np}scenarios.md`) ?? null);
    compare(`${op}problem.md`, `${np}problem.md`, residual(o, `${op}problem.md`, none, 0), residual(n, `${np}problem.md`, none, 0));
  }
  const rawPath = (m) => (typeof m.rawPath === "string" ? m.rawPath.replace(/\/+$/, "") : JSON.stringify(m.rawPath));
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

export function formatHuman(result) {
  if (!result.changed) return "no differences\n";
  return "";
}

export function formatJson(result) {
  return JSON.stringify(result, null, 2) + "\n";
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
