import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("package.json shape (R-REPO-5, layout table)", () => {
  assert.equal(pkg.name, "unbuilt");
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=22");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts.validate, "string");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(fs.existsSync(path.join(ROOT, "package-lock.json")), false);
});

test("LICENSE is MIT for Vasil Trifonov, 2026", () => {
  const text = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) 2026 Vasil Trifonov/);
});

test("plugin.json manifest (R-PKG-1)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(m.name, "unbuilt");
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof m.description, "string");
  assert.deepEqual(m.author, { name: "Vasil Trifonov" });
  assert.equal(m.repository, "https://github.com/vtrifonov/unbuilt");
  assert.equal(m.license, "MIT");
  for (const k of ["unbuilt", "spec", "skills"]) assert.ok(m.keywords.includes(k));
  for (const k of ["commands", "agents", "hooks", "mcpServers"]) assert.equal(m[k], undefined);
});

test("marketplace.json manifest (R-PKG-2)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(m.name, "unbuilt");
  assert.deepEqual(m.owner, { name: "Vasil Trifonov" });
  assert.equal(typeof m.description, "string"); assert.ok(m.description.length > 0);
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, "unbuilt");
  assert.ok(m.plugins[0].source === "." || m.plugins[0].source === "./");
  assert.equal(typeof m.plugins[0].description, "string");
});

test("ci.yml shape (R-CI-1..6)", () => {
  const y = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(y, /runs-on: ubuntu-latest/);
  assert.match(y, /node-version: 22\b/);
  assert.match(y, /actions\/checkout@v4/);
  assert.match(y, /actions\/setup-node@v4/);
  assert.match(y, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(y, /npm (ci|install)/);
  assert.doesNotMatch(y, /cache/);
  assert.doesNotMatch(y, /claude plugin validate/);
  const order = ["npm test", "node scripts/validate.mjs template", "node scripts/validate.mjs examples/clipjar"]
    .map((s) => y.indexOf(s));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2]);
});

import { RULES, SUPPORTED_FORMAT_VERSION } from "../scripts/lib/rules.mjs";
import { countWords } from "../scripts/lib/markdown.mjs";
const FORMAT = fs.readFileSync(path.join(ROOT, "FORMAT.md"), "utf8");
test("FORMAT.md names every rule, has the ten sections in order and the version line (R-FMT-1, R-FMT-2, R-FMT-4)", () => {
  for (const r of RULES) assert.ok(FORMAT.includes("`" + r.name + "`"), r.name);
  const titles = ["What an unbuilt repo is", "Version", "Required files", "Optional files", "Requirement IDs", "Modality", "Redaction rules", "Size budgets", "What builders are promised", "The YAML subset"];
  let last = -1;
  titles.forEach((t, i) => { const at = FORMAT.indexOf(`\n## ${i + 1}. ${t}\n`); assert.ok(at > last, t); last = at; });
  const v = FORMAT.match(/^Version: (\d+)$/m); assert.ok(v); assert.equal(Number(v[1]), SUPPORTED_FORMAT_VERSION);
  assert.ok(FORMAT.indexOf("Version: ") < FORMAT.indexOf("\n## 1. "));
  // R-FMT-3 targets 2,500 words; R-FMT-43 (MUST) outranks it, so the limit is 2,600 (controller ruling, wave C).
  assert.ok(countWords(FORMAT) <= 2600, "FORMAT.md over 2,600 words");
});
test("FORMAT.md section 7 and the leak-secret row state the credential and Bearer value conditions the validator applies (CR-COR-23)", () => {
  const s7 = FORMAT.slice(FORMAT.indexOf("\n## 7. "), FORMAT.indexOf("\n## 8. "));
  const row = fs.readFileSync(path.join(ROOT, "skills/validate/SKILL.md"), "utf8").split("\n").find((l) => l.startsWith("| `leak-secret` |"));
  for (const [name, text] of [["FORMAT.md", s7], ["leak-secret row", row]]) {
    assert.match(text, /eight or more characters, holds a digit and is not a placeholder/, name);
    assert.match(text, /`Bearer` values? of 20 or more characters/, name);
    assert.match(text, /a digit and a letter in each half/, name);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"), /a `Bearer` value needs header context or a digit and a letter in each half/);
});
test("FORMAT.md section 7 states how declined names are handled in unbuilt.yaml (R-FMT-43)", () => {
  const s7 = FORMAT.slice(FORMAT.indexOf("\n## 7. "), FORMAT.indexOf("\n## 8. "));
  assert.match(s7, /platform-blind/);
  assert.match(s7, /`desktop`, `server` or `mobile`/);
  assert.match(s7, /module `id` gets a role-word ID that still matches `\^\[A-Z\]\{2,8\}\$`; every declaration, citation and matrix row is renamed/);
  assert.match(s7, /`name`, a module `path` and a `substitutions` name get a neutral kebab-case name; the folder, directory, file and matrix column are renamed/);
});

import { runCli, runJson } from "./helpers.mjs";
import { blankCommentsAndFences } from "../scripts/lib/markdown.mjs";
const TEMPLATE = path.join(ROOT, "template");
const mdFiles = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".md")).map((d) => path.join(d.parentPath ?? d.path, d.name));
test("template passes clean with zero warnings (R-TPL-6)", () => {
  const r = runJson([TEMPLATE, "--json"]);
  assert.equal(r.code, 0); assert.deepEqual(r.result, { errors: [], warnings: [] });
});
test("template has no placeholders outside comments and stays under 1,200 words (R-TPL-5, R-TPL-7)", () => {
  let words = 0;
  for (const f of mdFiles(TEMPLATE)) {
    const text = fs.readFileSync(f, "utf8"); words += countWords(text);
    assert.doesNotMatch(blankCommentsAndFences(text), /<[a-z][a-z0-9-]*>/, f);
  }
  words += countWords(fs.readFileSync(path.join(TEMPLATE, "unbuilt.yaml"), "utf8"));
  assert.ok(words < 1200, `template has ${words} words`);
});
test("template version equals FORMAT.md version (R-FMT-2)", () => {
  const y = fs.readFileSync(path.join(TEMPLATE, "unbuilt.yaml"), "utf8");
  assert.equal(Number(y.match(/^unbuilt: (\d+)/m)[1]), SUPPORTED_FORMAT_VERSION);
});
test("template files and comments (R-TPL-2, R-TPL-3, R-TPL-4)", () => {
  const expected = ["BUILD.md", "README.md", "SPEC.md", "constraints.md", "design/README.md", "modules/core/SPEC.md", "modules/core/problem.md", "modules/core/scenarios.md", "redaction.md", "unbuilt.yaml"];
  const actual = fs.readdirSync(TEMPLATE, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.relative(TEMPLATE, path.join(d.parentPath ?? d.path, d.name)).split(path.sep).join("/")).sort();
  assert.deepEqual(actual, expected);
  // R-TPL-4: one FORMAT.md §n comment per section (a heading line and everything up to the next heading), not one per file.
  for (const f of mdFiles(TEMPLATE)) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const starts = lines.map((l, i) => (/^#{1,6} /.test(l) ? i : -1)).filter((i) => i >= 0);
    assert.ok(starts.length > 0, `${f} has no heading`);
    starts.forEach((start, k) => {
      const section = lines.slice(start, starts[k + 1] ?? lines.length).join("\n");
      assert.match(section, /<!--[\s\S]*?FORMAT\.md §\d+[\s\S]*?-->/, `${f}: section "${lines[start]}" has no FORMAT.md comment`);
    });
  }
});

const EXAMPLE = path.join(ROOT, "examples/clipjar");
test("example passes the validator (R-EX-13)", () => {
  const r = runJson([EXAMPLE, "--json"]);
  assert.equal(r.code, 0, JSON.stringify(r.result)); assert.deepEqual(r.result.errors, []);
});
test("example caps, inferred MUSTs, facts and denylist (R-EX-3, R-EX-6, R-EX-7, R-EX-14, R-EX-15)", () => {
  const texts = mdFiles(EXAMPLE).map((f) => fs.readFileSync(f, "utf8"));
  const all = texts.join("\n") + "\n" + fs.readFileSync(path.join(EXAMPLE, "unbuilt.yaml"), "utf8");
  assert.ok(texts.reduce((n, t) => n + countWords(t), 0) <= 6000);
  const y = fs.readFileSync(path.join(EXAMPLE, "unbuilt.yaml"), "utf8");
  assert.ok((y.match(/^\s+- id: /gm) || []).length <= 5);
  assert.match(y, /^interview: none$/m);
  for (const t of texts) for (const line of t.split("\n")) if (/^- \*\*[A-Z]{2,8}-\d+\*\* \(MUST\)/.test(line)) assert.match(line, /^- \*\*[A-Z]{2,8}-\d+\*\* \(MUST\) \(inferred\) /, line);
  for (const fact of ["Swift 6.2", "Makefile", "macOS 14", "GRDB", "KeyboardShortcuts", "Accessibility", "notarized", "Translocation", "Application Support/Clipjar", "network"]) assert.ok(all.toLowerCase().includes(fact.toLowerCase()), fact);
  assert.match(fs.readFileSync(path.join(EXAMPLE, "README.md"), "utf8"), /\bMIT\b/, "MIT fact in README.md");
  for (const vendor of ["Google", "Microsoft", "Amazon", "Slack", "Atlassian"]) assert.ok(!all.toLowerCase().includes(vendor.toLowerCase()), vendor);
  assert.ok(!fs.existsSync(path.join(EXAMPLE, "retrospective.md")));
});

test("README parts, install form and size (R-DOC-1, R-DOC-3, R-PKG-6, R-PKG-7)", () => {
  const md = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const titles = ["What an unbuilt repo is", "The three verbs", "Install", "Quick start", "The example", "Prior art and positioning", "FAQ", "Discovery", "License"];
  let last = -1; for (const t of titles) { const at = md.indexOf(`\n## ${t}\n`); assert.ok(at > last, t); last = at; }
  assert.ok(md.includes("claude plugin marketplace add vtrifonov/unbuilt") && md.includes("claude plugin install unbuilt@unbuilt"));
  for (const v of ["extract", "build", "validate"]) { assert.ok(md.includes(`/unbuilt:${v}`)); assert.ok(md.includes(`prompts/${v}.md`)); }
  assert.doesNotMatch(md, /(?<![\w:.])\/(extract|build|validate)\b/); assert.doesNotMatch(md, /unbuilt-(extract|build|validate)/);
  assert.ok(md.includes("examples/clipjar") && md.includes("https://github.com/vtrifonov/clipjar") && md.includes("`unbuilt`"));
  assert.ok(countWords(md) < 1500);
});
test("CHANGELOG sections (R-DOC-4)", () => {
  const md = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  assert.ok(md.indexOf("\n## Format\n") > 0 && md.indexOf("\n## Plugin\n") > md.indexOf("\n## Format\n"));
  assert.match(md, /### 1 /); assert.match(md, /### 0\.1\.0 /);
});

import { walkInstance, readText } from "../scripts/lib/walk.mjs";
import { scanText } from "../scripts/lib/redaction.mjs";
import { countLines } from "../scripts/lib/markdown.mjs";
const repoFiles = () => walkInstance(ROOT).entries.filter((e) => e.kind === "file");
test("layout (R-REPO-1..5, R-PKG-5)", () => {
  const top = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== ".git" && d.name !== "node_modules").map((d) => d.name).sort();
  assert.deepEqual(top, [".claude-plugin", ".github", "examples", "prompts", "scripts", "skills", "template", "test"]);
  for (const p of ["README.md", "FORMAT.md", "CHANGELOG.md", "LICENSE", "package.json", ".gitignore", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "skills/extract/SKILL.md", "skills/build/SKILL.md", "skills/validate/SKILL.md", "prompts/extract.md", "prompts/build.md", "prompts/validate.md", "scripts/validate.mjs", "scripts/lib/yaml-subset.mjs", "scripts/lib/rules.mjs", "scripts/lib/redaction.mjs", "test/validate.test.mjs", "test/yaml-subset.test.mjs", "test/redaction.test.mjs", "test/prompts-sync.test.mjs", "test/repo.test.mjs", "test/helpers.mjs", "test/fixtures/minimal-valid", "template", "examples/clipjar", ".github/workflows/ci.yml"]) assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  for (const p of ["bin", "commands", "agents", "hooks", "docs/superpowers", "package-lock.json"]) assert.ok(!fs.existsSync(path.join(ROOT, p)), p);
});
test("no AI attribution anywhere (R-REPO-6)", () => {
  const markers = ["Co-Authored-By: " + "Claude", "Claude-" + "Session:", "Generated with [" + "Claude", "claude.ai/" + "code/session"];
  for (const e of repoFiles()) { if (!e.isText) continue; const t = readText(path.join(ROOT, e.path)); for (const m of markers) assert.ok(!t.includes(m), `${e.path} contains ${m}`); }
});
test("no home paths, emails, IPs or secrets in repo files (R-REPO-7, R-REPO-10)", () => {
  const keep = new Set(["email", "ipv4", "ipv6", "home-path", "secret"]);
  for (const e of repoFiles()) {
    if (!e.isText || e.path.startsWith("test/fixtures/") || /^test\/.*\.test\.mjs$/.test(e.path) || e.path === "test/helpers.mjs") continue;
    const bad = scanText(readText(path.join(ROOT, e.path))).filter((f) => keep.has(f.pattern));
    assert.deepEqual(bad.map((f) => `${e.path}:${f.line} ${f.pattern} ${f.match.slice(0, 2)}…`), []);
  }
});
// Every text file under the repository root, test/fixtures/** included; only .git and node_modules are skipped.
// A file is text when it holds no NUL byte, as in the validator's walk.
function allTextFiles(rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const r = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (ent.isDirectory()) out.push(...allTextFiles(r));
    else if (ent.isFile()) {
      const buf = fs.readFileSync(path.join(ROOT, r));
      if (!buf.includes(0)) out.push({ path: r, text: buf.toString("utf8") });
    }
  }
  return out;
}
test("no committed text file holds a complete secret shape except the AWS documentation key (R-TST-9)", () => {
  const files = allTextFiles();
  assert.ok(files.some((f) => f.path.startsWith("test/fixtures/leak-secret/")), "the scan must reach test/fixtures/**");
  const bad = [];
  for (const f of files) {
    for (const hit of scanText(f.text)) {
      // Only the masked start of a hit is printed, so a failure never echoes the secret.
      if (hit.pattern === "secret" && !hit.match.includes("AKIAIOSFODNN7EXAMPLE")) bad.push(`${f.path}:${hit.line} ${hit.match.slice(0, 2)}…`);
    }
  }
  assert.deepEqual(bad, []);
});
test("ES modules with node: imports only; Markdown under 1,500 lines (R-REPO-8, R-REPO-9)", () => {
  for (const e of repoFiles()) {
    if (/\.(js|cjs|ts)$/.test(e.path)) assert.fail(`${e.path} is not .mjs`);
    if (e.path.endsWith(".mjs")) for (const m of readText(path.join(ROOT, e.path)).matchAll(/from\s+["']([^"']+)["']/g)) assert.ok(m[1].startsWith("node:") || m[1].startsWith("."), `${e.path} imports ${m[1]}`);
    if (e.path.endsWith(".md")) assert.ok(countLines(readText(path.join(ROOT, e.path))) < 1500, e.path);
  }
});
