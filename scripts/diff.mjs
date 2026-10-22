import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitize, InstanceError, scanInstance, readIncludedFile } from "./snapshot.mjs";
import { parse } from "./lib/yaml-subset.mjs";

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
        modules.push({ id: item.id, path: item.path, rawPath: item.path, maturity: item.maturity });
      }
    }
    const substitutions = isObject(meta) && Array.isArray(meta.substitutions) ? meta.substitutions.filter((s) => typeof s === "string") : [];
    return { meta: isObject(meta) ? meta : null, text, dirs, modules, substitutions, prefixes: [...modules.map((m) => m.id), "INV"] };
  } catch (e) {
    if (e instanceof InstanceError) e.message = `${side}: ${e.message}`;
    throw e;
  }
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
    if (err instanceof InstanceError) process.stderr.write(`${err.message}\n`);
    else process.stderr.write(`internal error: ${err.message}\n${err.stack}\n`);
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
