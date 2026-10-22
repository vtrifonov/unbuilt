import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(REPO_ROOT, "scripts", "validate.mjs");
export const FIXTURES = path.join(REPO_ROOT, "test", "fixtures");

export function runCli(args, { env, cwd } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, cwd });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function runJson(args, opts) {
  const r = runCli(args, opts);
  return { ...r, result: JSON.parse(r.stdout) };
}

export function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unbuilt-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
