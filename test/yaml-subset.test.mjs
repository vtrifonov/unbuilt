import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../scripts/lib/yaml-subset.mjs";

const accepts = [
  ["key: value", "a: b\n", { a: "b" }],
  ["quoted with colon-space and hash", 'summary: "x: y # z"\n', { summary: "x: y # z" }],
  ["single-quoted escape", "s: 'it''s'\n", { s: "it's" }],
  ["double-quoted escapes", 's: "a\\"b\\\\c"\n', { s: 'a"b\\c' }],
  ["trailing comment", "name: clipjar # c\n", { name: "clipjar" }],
  ["tab before comment", "name: clipjar\t# the name\n", { name: "clipjar" }],
  ["trailing space", "name: clipjar \n", { name: "clipjar" }],
  ["url", "url: https://github.com/vtrifonov/clipjar\n", { url: "https://github.com/vtrifonov/clipjar" }],
  ["comments and blanks anywhere", "# top\n\na: 1\n  # indented comment\n\nb: 2\n", { a: 1, b: 2 }],
  ["crlf", "a: 1\r\nb: x\r\n", { a: 1, b: "x" }],
  ["bom", "\uFEFFa: 1\n", { a: 1 }],
  ["booleans", "a: true\nb: false\n", { a: true, b: false }],
  ["integers", "a: 0\nb: 42\ncount: -5\n", { a: 0, b: 42, count: -5 }],
  ["quoted integer is a string", 'a: "1"\n', { a: "1" }],
  ["no trailing newline", "a: b", { a: "b" }],
];
for (const [name, input, expected] of accepts) {
  test(`accepts: ${name}`, () => {
    const r = parse(input);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.value, expected);
  });
}

const rejects = [
  ["tab indentation", "a: 1\n\tb: 2\n", 2],
  ["no space after colon", "name:clipjar\n", 1],
  ["two spaces after colon", "name:  clipjar\n", 1],
  ["unsupported escape", 's: "a\\nb"\n', 1],
  ["unterminated quote", 's: "abc\n', 1],
  ["trailing content after quote", 's: "a" b\n', 1],
  ["duplicate top-level key", "a: 1\nb: 2\na: 3\n", 3],
  ["key on", "on: 1\n", 1], ["key no", "no: 1\n", 1], ["key y", "y: 1\n", 1],
  ["key true", "true: 1\n", 1], ["key null", "null: 1\n", 1],
  ["bad key shape", "Name: x\n", 1],
  ["empty value", "a:\n", 1],
];
for (const [name, input, line] of rejects) {
  test(`rejects: ${name}`, () => {
    const r = parse(input);
    assert.equal(r.value, null);
    assert.ok(r.errors.length >= 1);
    assert.equal(r.errors[0].line, line);
    assert.match(r.errors[0].message, new RegExp(`^line ${line}: `));
  });
}

test("lines map records key lines", () => {
  const r = parse("a: 1\n\nb: 2\n");
  assert.equal(r.lines.get("a"), 1);
  assert.equal(r.lines.get("b"), 3);
});

const LIST_OF_MAPS = "m:\n  - id: CORE\n    path: modules/core\n    maturity: shipped\n  - id: UI\n    path: modules/ui\n    maturity: partial\n";

const listAccepts = [
  ["list at indent 0", "p:\n- a\n- b\n", { p: ["a", "b"] }],
  ["list at indent 2 closed by a scalar key", "p:\n  - a\n  - b\nq: 1\n", { p: ["a", "b"], q: 1 }],
  ["list head and item comments", "p: # platforms\n  - macos # desktop\n", { p: ["macos"] }],
  ["list of maps", LIST_OF_MAPS, {
    m: [
      { id: "CORE", path: "modules/core", maturity: "shipped" },
      { id: "UI", path: "modules/ui", maturity: "partial" },
    ],
  }],
  ["map continuation at column 2 with items at indent 0", "m:\n- id: CORE\n  path: modules/core\n", {
    m: [{ id: "CORE", path: "modules/core" }],
  }],
  ["integer items", "nums:\n  - 1\n  - -5\n", { nums: [1, -5] }],
];
for (const [name, input, expected] of listAccepts) {
  test(`accepts: ${name}`, () => {
    const r = parse(input);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.value, expected);
  });
}

const listRejects = [
  ["three-level nesting", "m:\n  - id: A\n    sub:\n      - x\n", 3],
  ["map value that is a list", "m:\n  - id: A\n    sub:\n", 3],
  ["list head with nothing following", "p:\n", 1],
  ["list head followed by a scalar key", "p:\nq: 1\n", 1],
  ["duplicate key inside one map", "m:\n  - id: A\n    id: B\n", 3],
  ["inconsistent list indentation", "p:\n  - a\n- b\n", 3],
  ["list item outside a list", "a: 1\n- b\n", 2],
  ["continuation at the wrong column", "m:\n  - id: A\n   path: x\n", 3],
  ["scalar and map items mixed", "m:\n  - a\n  - id: B\n", 3],
];
for (const [name, input, line] of listRejects) {
  test(`rejects: ${name}`, () => {
    const r = parse(input);
    assert.equal(r.value, null);
    assert.ok(r.errors.length >= 1);
    assert.equal(r.errors[0].line, line);
    assert.match(r.errors[0].message, new RegExp(`^line ${line}: `));
  });
}

test("rejects: empty list head names the key", () => {
  const r = parse("p:\n");
  assert.match(r.errors[0].message, /^line 1: "p:" has no value; a scalar or a list must follow$/);
});

test("rejects: nested list uses the nesting message", () => {
  for (const input of ["m:\n  - id: A\n    sub:\n      - x\n", "m:\n  - id: A\n    sub:\n"]) {
    const r = parse(input);
    assert.match(r.errors[0].message, /nesting deeper than a list of flat maps is not allowed/);
  }
});

test("lines map records list-of-maps items and keys", () => {
  const r = parse(LIST_OF_MAPS);
  assert.equal(r.lines.get("m"), 1);
  assert.equal(r.lines.get("m[0]"), 2);
  assert.equal(r.lines.get("m[0].path"), 3);
  assert.equal(r.lines.get("m[1]"), 5);
});
