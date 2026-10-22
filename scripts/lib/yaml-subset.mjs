const KEY_RE = /^[a-z_][a-z0-9_]*$/;
const INT_RE = /^-?(0|[1-9][0-9]*)$/;
const BOOL_RE = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const NULL_RE = /^(?:~|null|Null|NULL)$/;
const YAML11_INT_RE = /^(?:[-+]?(0b[01_]+|0o?[0-7_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(:[0-5]?[0-9])+|[0-9][0-9_]*))$/;
const YAML11_FLOAT_RE = /^(?:[-+]?(\.[0-9]+|[0-9][0-9_]*(\.[0-9_]*)?)([eE][-+]?[0-9]+)?|[-+]?[0-9][0-9_]*(:[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(inf|Inf|INF)|\.(nan|NaN|NAN))$/;
const YAML11_TIMESTAMP_RE = /^(?:[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}([Tt ].*)?)$/;
const RESOLVED_AS = [
  [BOOL_RE, "boolean"],
  [NULL_RE, "null"],
  [YAML11_INT_RE, "integer"],
  [YAML11_FLOAT_RE, "float"],
  [YAML11_TIMESTAMP_RE, "timestamp"],
  [/^<<$/, "merge key"],
  [/^=$/, "value key"],
];
const FIRST_CHAR_FEATURE = {
  "[": "flow collections",
  "{": "flow collections",
  "|": "block scalars",
  ">": "block scalars",
  "&": "anchors",
  "*": "aliases",
  "!": "tags",
  "%": "directives",
};
const INDICATORS = new Set(["?", ":", ",", "]", "}", "#", "'", '"', "@", "`"]);
const MAP_ITEM_RE =/^[^ \t'"]*?:(?=[ \t]|$)/;
const NESTING = "nesting deeper than a list of flat maps is not allowed";
// C0 and C1 controls other than tab (CR is reported separately), DEL, U+2028 (Zl), U+2029 (Zp) and a BOM past
// the start of the file: YAML 1.1 splits lines on some and refuses the rest (spec amendment 8d).
const BOM = String.fromCharCode(0xfeff);
const SPECIAL_RE = new RegExp(`[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f\\p{Zl}\\p{Zp}${BOM}]`, "u");

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
  const reject = rejectBare(v);
  if (reject) return fail(`${reject}; quote this value`);
  return { value: v };
}

function rejectBare(v) {
  const c = v[0];
  if (FIRST_CHAR_FEATURE[c]) return `${FIRST_CHAR_FEATURE[c]} are not allowed`;
  if (INDICATORS.has(c) || /^-([ \t]|$)/.test(v)) {
    return `value "${v}" starts with the YAML indicator "${c}"`;
  }
  if (/:[ \t]/.test(v) || v.includes("\t#") || v.endsWith(":")) {
    return `value "${v}" contains ": " or ends in ":"`;
  }
  for (const [re, kind] of RESOLVED_AS) {
    if (re.test(v)) return `value "${v}" would be read as a ${kind} by YAML 1.1`;
  }
  return null;
}

function keyError(key) {
  if (!KEY_RE.test(key)) return `invalid key "${key}"; keys must match ^[a-z_][a-z0-9_]*$`;
  if (BOOL_RE.test(key)) return `key "${key}" would be read as a boolean by YAML; rename it`;
  if (NULL_RE.test(key)) return `key "${key}" would be read as a null by YAML; rename it`;
  return null;
}

function parseKeyLine(text, n) {
  const fail = (msg) => ({ error: `line ${n}: ${msg}` });
  const colon = text.indexOf(":");
  if (colon < 0) return fail(`expected "key: value" in "${text}"`);
  const key = text.slice(0, colon);
  const kErr = keyError(key);
  if (kErr) return fail(kErr);
  const rest = text.slice(colon + 1);
  if (isBlankOrComment(rest)) return { key, head: true };
  if (rest[0] !== " " || rest[1] === " " || rest[1] === "\t") {
    return fail(`exactly one space must follow the colon in "${text.replace(/[ \t]+$/, "")}"`);
  }
  const s = parseScalar(rest.slice(1), n);
  if (s.error) return { key, error: s.error };
  return { key, value: s.value };
}

export function parse(text) {
  const errors = [];
  const lines = new Map();
  const entries = new Map();
  const err = (n, msg) => errors.push({ line: n, message: `line ${n}: ${msg}` });
  let list = null;

  const closeList = () => {
    if (!list) return;
    if (!list.sawItem) err(list.headLine, `"${list.key}:" has no value; a scalar or a list must follow`);
    entries.set(list.key, list.items.map((x) => (x instanceof Map ? Object.fromEntries(x) : x)));
    list = null;
  };

  const addMapEntry = (body, n) => {
    const kv = parseKeyLine(body, n);
    if (kv.error && !kv.key) return errors.push({ line: n, message: kv.error });
    const map = list.currentMap;
    const prefix = `${list.key}[${list.items.length - 1}]`;
    if (map.has(kv.key)) return err(n, `duplicate key "${kv.key}" (first at line ${lines.get(`${prefix}.${kv.key}`)})`);
    lines.set(`${prefix}.${kv.key}`, n);
    if (kv.head) return err(n, NESTING);
    if (kv.error) return errors.push({ line: n, message: kv.error });
    map.set(kv.key, kv.value);
  };

  const handleItem = (indent, body, n) => {
    if (!list) return err(n, "list item outside a list");
    list.sawItem = true;
    if (list.itemIndent === null) {
      if (indent !== 0 && indent !== 2) return err(n, "list items must be indented 0 or 2 spaces");
      list.itemIndent = indent;
    } else if (indent > list.itemIndent) {
      return err(n, NESTING);
    } else if (indent < list.itemIndent) {
      return err(n, "inconsistent list indentation");
    }
    const itemBody = body === "-" ? "" : body.slice(2);
    if (/^[ \t]*(#.*)?$/.test(itemBody)) return err(n, "empty list item");
    if (itemBody[0] === " " || itemBody[0] === "\t") return err(n, 'exactly one space must follow "-"');
    const kind = MAP_ITEM_RE.test(itemBody) ? "maps" : "scalars";
    if (list.kind && list.kind !== kind) return err(n, "a list holds either scalars or maps, not both");
    list.kind = kind;
    const index = list.items.length;
    lines.set(`${list.key}[${index}]`, n);
    if (kind === "scalars") {
      const s = parseScalar(itemBody, n);
      if (s.error) return errors.push({ line: n, message: s.error });
      list.items.push(s.value);
      return;
    }
    list.currentMap = new Map();
    list.items.push(list.currentMap);
    addMapEntry(itemBody, n);
  };

  let src = text.startsWith(BOM) ? text.slice(1) : text;
  src = src.replace(/\r\n/g, "\n");
  const rows = src.split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();

  rows.forEach((line, idx) => {
    const n = idx + 1;
    if (line.includes("\r")) return err(n, "carriage return without line feed; use \\n or \\r\\n line endings");
    const special = SPECIAL_RE.exec(line);
    if (special) {
      const hex = special[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
      return err(n, `special character U+${hex} is not allowed; quote-free YAML cannot carry it`);
    }
    const lead =/^[ \t]*/.exec(line)[0];
    if (lead.includes("\t")) return err(n, "tab in indentation; use spaces");
    if (/^ *$/.test(line) || /^ *#/.test(line)) return;
    if (/^(---|\.\.\.)( |$)/.test(line)) return err(n, "document markers (--- / ...) are not allowed");
    if (line.startsWith("%")) return err(n, "directives (%) are not allowed");
    const indent = lead.length;
    const body = line.slice(indent);

    if (body === "-" || body.startsWith("- ")) return handleItem(indent, body, n);

    if (indent > 0) {
      if (!list || list.kind !== "maps") return err(n, "unexpected indentation");
      const col = list.itemIndent + 2;
      if (indent !== col) return err(n, `map continuation must be indented to column ${col}`);
      return addMapEntry(body, n);
    }

    closeList();
    const kv = parseKeyLine(line, n);
    if (kv.error && !kv.key) return errors.push({ line: n, message: kv.error });
    if (lines.has(kv.key)) return err(n, `duplicate key "${kv.key}" (first at line ${lines.get(kv.key)})`);
    lines.set(kv.key, n);
    if (kv.error) return errors.push({ line: n, message: kv.error });
    if (kv.head) {
      list = { key: kv.key, headLine: n, itemIndent: null, kind: null, items: [], currentMap: null, sawItem: false };
      return;
    }
    entries.set(kv.key, kv.value);
  });
  closeList();

  errors.sort((a, b) => a.line - b.line);
  return { value: errors.length ? null : Object.fromEntries(entries), errors, lines };
}
