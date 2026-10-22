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
