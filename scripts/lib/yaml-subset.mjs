const KEY_RE = /^[a-z_][a-z0-9_]*$/;
const INT_RE = /^-?(0|[1-9][0-9]*)$/;
const BOOL_RE = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const NULL_RE = /^(?:~|null|Null|NULL)$/;

function isBlankOrComment(rest) {
  return /^[ \t]*$/.test(rest) || /^[ \t]+#/.test(rest);
}

function parseDoubleQuoted(raw) {
  let out = "";
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\") {
      const n = raw[i + 1];
      if (n === '"' || n === "\\") {
        out += n;
        i++;
        continue;
      }
      if (n === undefined) return { error: "unterminated quoted value" };
      return { error: `unsupported escape \\${n} in double-quoted value; only \\" and \\\\ are allowed` };
    }
    if (c === '"') return { value: out, rest: raw.slice(i + 1) };
    out += c;
  }
  return { error: "unterminated quoted value" };
}

function parseSingleQuoted(raw) {
  let out = "";
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'") {
      if (raw[i + 1] === "'") {
        out += "'";
        i++;
        continue;
      }
      return { value: out, rest: raw.slice(i + 1) };
    }
    out += c;
  }
  return { error: "unterminated quoted value" };
}

function stripComment(raw) {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === "#" && (raw[i - 1] === " " || raw[i - 1] === "\t")) return raw.slice(0, i);
  }
  return raw;
}

export function parseScalar(raw, lineNo) {
  const fail = (msg) => ({ error: `line ${lineNo}: ${msg}` });
  if (raw[0] === '"' || raw[0] === "'") {
    const r = raw[0] === '"' ? parseDoubleQuoted(raw) : parseSingleQuoted(raw);
    if (r.error) return fail(r.error);
    if (!isBlankOrComment(r.rest)) return fail("unexpected text after the closing quote");
    return { value: r.value };
  }
  const v = stripComment(raw).replace(/[ \t]+$/, "");
  if (v === "true") return { value: true };
  if (v === "false") return { value: false };
  if (INT_RE.test(v)) return { value: Number(v) };
  return { value: v };
}

function keyError(key) {
  if (!KEY_RE.test(key)) return `invalid key "${key}"; keys must match ^[a-z_][a-z0-9_]*$`;
  if (BOOL_RE.test(key)) return `key "${key}" would be read as a boolean by YAML; rename it`;
  if (NULL_RE.test(key)) return `key "${key}" would be read as a null by YAML; rename it`;
  return null;
}

export function parse(text) {
  const errors = [];
  const lines = new Map();
  const entries = new Map();
  const err = (n, msg) => errors.push({ line: n, message: `line ${n}: ${msg}` });

  let src = text.startsWith("﻿") ? text.slice(1) : text;
  src = src.replace(/\r\n/g, "\n");
  const rows = src.split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();

  rows.forEach((line, idx) => {
    const n = idx + 1;
    const lead = /^[ \t]*/.exec(line)[0];
    if (lead.includes("\t")) return err(n, "tab in indentation; use spaces");
    if (/^ *$/.test(line) || /^ *#/.test(line)) return;
    if (lead.length > 0) return err(n, "unexpected indentation");

    const colon = line.indexOf(":");
    if (colon < 0) return err(n, `expected "key: value" in "${line}"`);
    const key = line.slice(0, colon);
    const kErr = keyError(key);
    if (kErr) return err(n, kErr);
    const rest = line.slice(colon + 1);

    if (isBlankOrComment(rest)) return err(n, `"${key}:" has no value; a scalar or a list must follow`);
    if (rest[0] !== " " || rest[1] === " " || rest[1] === "\t") {
      return err(n, `exactly one space must follow the colon in "${line.replace(/[ \t]+$/, "")}"`);
    }
    const s = parseScalar(rest.slice(1), n);
    if (s.error) return errors.push({ line: n, message: s.error });
    if (entries.has(key)) return err(n, `duplicate key "${key}" (first at line ${lines.get(key)})`);
    entries.set(key, s.value);
    lines.set(key, n);
  });

  errors.sort((a, b) => a.line - b.line);
  return { value: errors.length ? null : Object.fromEntries(entries), errors, lines };
}
