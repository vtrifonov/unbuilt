import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIXTURES, makePng, makeTempDir, runJson, runScan, writeIn } from "./helpers.mjs";

// The leak text comes from the validator's own fixtures, so no new secret shape is committed.
const fixtureReadme = (kind) => fs.readFileSync(path.join(FIXTURES, `leak-${kind}`, "README.md"), "utf8");
const scanJson = (args) => {
  const r = runScan(args);
  return { ...r, result: JSON.parse(r.stdout) };
};

test("--help prints usage and exits 0", () => {
  const r = runScan(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^usage: node scripts\/scan-leaks\.mjs <dir> \[--json\] \[--allow-host <host>\]\.\.\./);
  // --help states the limits, since a clean result is easy to over-read.
  for (const s of ["shapes, not names", "never git history", "skipped", "--allow-host", "0 no leaks, 1 leaks found, 2 usage or read error", "public_hosts", "node_modules"]) assert.ok(r.stdout.includes(s), s);
});

test("a clean directory exits 0 with no leaks and nothing skipped", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "src/index.mjs", "export const answer = 42;\n");
  const r = scanJson([dir, "--json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result, { leaks: [], skipped: [] });
  assert.equal(runScan([dir]).stdout, "ok: no leaks found\n");
});

for (const kind of ["email", "ipv4", "hostname", "home-path", "secret"]) {
  test(`a ${kind} leak exits 1 and is reported exactly as the validator reports it, masked`, (t) => {
    const dir = makeTempDir(t);
    writeIn(dir, "README.md", fixtureReadme(kind));
    const r = scanJson([dir, "--json"]);
    assert.equal(r.code, 1);
    assert.ok(r.result.leaks.length > 0);
    for (const f of r.result.leaks) assert.equal(f.rule, `leak-${kind}`);
    const v = runJson([dir, "--json"]).result.errors.filter((f) => f.rule.startsWith("leak-"));
    assert.deepEqual(r.result.leaks, v);
  });
}

test("human output lists each leak and ends with the count", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "README.md", fixtureReadme("email"));
  const r = runScan([dir]);
  assert.equal(r.code, 1);
  const lines = r.stdout.trimEnd().split("\n");
  assert.match(lines[0], /^leak-email {7}  README\.md:\d+  email address .+ found;/);
  assert.equal(lines.at(-1), "1 leak(s) found");
});

test("--allow-host suppresses that exact hostname", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "README.md", fixtureReadme("hostname"));
  const host = ["build01", "widgets-intranet", "com"].join(".");
  assert.equal(runScan([dir, "--allow-host", host]).code, 0);
  assert.equal(runScan([dir, "--allow-host", "widgets-intranet.com"]).code, 1, "exact match only");
});

test("an unbuilt.yaml with an unsupported version yields no structure findings", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "unbuilt.yaml", "unbuilt: 99\nname: x\n");
  const r = scanJson([dir, "--json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result.leaks, []);
});

test("entries named .git are not scanned", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, ".git/config", fixtureReadme("email"));
  assert.equal(runScan([dir]).code, 0);
});

test("files that cannot be scanned are listed as skipped and do not change the exit code", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "big.txt", "w\n".repeat(3 * 1024 * 1024));
  writeIn(dir, "data.bin", Buffer.from([0x00, 0x01, 0x02, 0x00]));
  writeIn(dir, "huge.png", makePng({ totalBytes: 2097152 + 1 }));
  fs.symlinkSync("big.txt", path.join(dir, "link.txt"));
  const r = scanJson([dir, "--json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result.skipped, [
    { file: "big.txt", reason: "too large to scan" },
    { file: "data.bin", reason: "binary" },
    { file: "huge.png", reason: "image too large to scan" },
    { file: "link.txt", reason: "symlink" },
  ]);
  const human = runScan([dir]).stdout.split("\n");
  assert.ok(human.includes("skipped  big.txt  too large to scan"), human.join("\n"));
});

test("node_modules directories are listed as skipped, at any depth", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "node_modules/pkg/README.md", fixtureReadme("email"));
  writeIn(dir, "app/node_modules/x/index.js", "x\n");
  const r = scanJson([dir, "--json"]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result.skipped, [
    { file: "app/node_modules", reason: "node_modules not scanned" },
    { file: "node_modules", reason: "node_modules not scanned" },
  ]);
});

test("an image whose metadata cannot be parsed is listed as skipped", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "broken.png", makePng({ truncate: true }));
  const r = scanJson([dir, "--json"]);
  assert.deepEqual(r.result.skipped, [{ file: "broken.png", reason: "image could not be parsed" }]);
});

test("a data: image embed that cannot be scanned is listed as skipped with its line", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "a.md", "# A\n\n![x](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n");
  const r = scanJson([dir, "--json"]);
  assert.deepEqual(r.result.skipped, [{ file: "a.md", line: 3, reason: "embedded image not scanned" }]);
  assert.ok(runScan([dir]).stdout.split("\n").includes("skipped  a.md:3  embedded image not scanned"));
});

test("an svg too large for embed scanning is listed as skipped when it holds a data: image", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "big.svg", `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/>${" ".repeat(2097152)}</svg>\n`);
  const r = scanJson([dir, "--json"]);
  assert.deepEqual(r.result.skipped, [{ file: "big.svg", reason: "embedded images not scanned (svg too large)" }]);
});

test("usage errors exit 2 and print usage", (t) => {
  const dir = makeTempDir(t);
  writeIn(dir, "a.txt", "x\n");
  const cases = [
    [],
    [dir, dir],
    [dir, "--allow-host"],
    [dir, "--allow-host", "-x"],
    [dir, "--leaks-only"],
    [path.join(dir, "missing")],
    [path.join(dir, "a.txt")],
  ];
  for (const args of cases) {
    const r = runScan(args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, /usage: node scripts\/scan-leaks\.mjs/, JSON.stringify(args));
  }
});
