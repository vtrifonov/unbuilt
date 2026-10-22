import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "../scripts/lib/rules.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERBS = { extract: "<source-dir>", build: "<instance-dir>", validate: "<instance-dir>" };
const DENY = ["AskUserQuestion", "TodoWrite", "Bash(", "Read(", "Edit("];
function splitSkill(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, "frontmatter");
  const fm = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { fm, body: m[2].replace(/^\n+/, "") };
}
for (const [verb, placeholder] of Object.entries(VERBS)) {
  const skillPath = path.join(ROOT, "skills", verb, "SKILL.md");
  const promptPath = path.join(ROOT, "prompts", `${verb}.md`);
  // Temporary (Task 28 only): extract and build arrive in Tasks 29–30, so their cases skip with a reason until then.
  // Task 30 deletes this constant and every `{ skip }` option below, so a missing skill is a failure from then on.
  const skip = verb === "validate" || fs.existsSync(skillPath) ? false : `skills/${verb}/SKILL.md is written in a later task`;
  test(`${verb}: frontmatter is exactly name and description (R-PKG-4)`, { skip }, () => {
    const { fm } = splitSkill(fs.readFileSync(skillPath, "utf8"));
    assert.deepEqual(Object.keys(fm).sort(), ["description", "name"]);
    assert.equal(fm.name, verb); assert.ok(fm.description.length > 20);
  });
  test(`${verb}: prompt equals header plus body (R-PKG-8, R-PKG-9)`, { skip }, () => {
    const skill = fs.readFileSync(skillPath, "utf8"); const prompt = fs.readFileSync(promptPath, "utf8");
    const { body } = splitSkill(skill);
    const lines = prompt.split("\n");
    assert.equal(lines[0], `# unbuilt ${verb}`);
    assert.equal(lines[1], `Paste this into your agent. Replace \`${placeholder}\` and \`<unbuilt-root>\` with real paths.`);
    assert.equal(lines[2], "");
    assert.equal(lines.slice(3).join("\n"), body);
    for (const t of [skill, prompt, body]) { assert.ok(t.endsWith("\n") && !t.endsWith("\n\n"), "exactly one trailing newline"); }
  });
  test(`${verb}: body is harness-agnostic and explains <unbuilt-root> once (R-EXT-2, R-PKG-10)`, { skip }, () => {
    const { body } = splitSkill(fs.readFileSync(skillPath, "utf8"));
    for (const d of DENY) assert.ok(!body.includes(d), d);
    const lines = body.split("\n").filter((l) => l.includes("${CLAUDE_PLUGIN_ROOT}"));
    assert.equal(lines.length, 1); assert.ok(lines[0].includes("<unbuilt-root>"));
    assert.ok(body.includes("node <unbuilt-root>/scripts/validate.mjs"));
    assert.ok(!/\$CLAUDE_PLUGIN_ROOT(?!\})/.test(body.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, "")));
  });
}
test("validate skill lists every rule (R-VAL-36)", () => {
  const { body } = splitSkill(fs.readFileSync(path.join(ROOT, "skills/validate/SKILL.md"), "utf8"));
  for (const r of RULES) assert.ok(body.includes("`" + r.name + "`"), r.name);
  assert.match(body, /exit code/i); assert.match(body, /warnings never fail CI/i);
});
test("extract skill carries the R-EXT-43 worked example verbatim", () => {
  const { body } = splitSkill(fs.readFileSync(path.join(ROOT, "skills/extract/SKILL.md"), "utf8"));
  assert.ok(body.includes("name: acmesync"), "draft name");
  assert.ok(body.includes("acmesync-unbuilt"), "draft folder");
  assert.ok(body.includes("name: ticket-sync"), "chosen name");
  assert.ok(body.includes("ticket-sync-unbuilt"), "renamed folder");
  assert.ok(body.includes("Syncs tickets from the issue tracker to the work tracker."), "rewritten summary");
});
