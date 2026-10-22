export const DEFAULT_ALLOW_HOSTS = [
  "example.com", "example.org", "example.net", "localhost", "github.com", "githubusercontent.com",
  "npmjs.com", "pypi.org", "crates.io", "w3.org", "schema.org", "purl.org", "ns.adobe.com", "iptc.org", "ns.useplus.org",
];

function normalizeOpts(opts = {}) {
  return {
    allowHosts: [...DEFAULT_ALLOW_HOSTS, ...(opts.allowHosts ?? [])].map((h) => h.toLowerCase()),
    exactHosts: (opts.exactHosts ?? []).map((h) => h.toLowerCase()),
  };
}

export function isHostAllowed(host, opts) {
  const o = opts && opts.allowHosts && opts.exactHosts ? opts : normalizeOpts(opts);
  const h = host.toLowerCase();
  if (o.exactHosts.includes(h)) return true;
  return o.allowHosts.some((a) => h === a || h.endsWith("." + a));
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const EMAIL_ALLOWED_BASE = ["example.com", "example.org", "example.net"];
const EMAIL_ALLOWED_SUFFIX = [".example", ".test", ".invalid", ".localhost"];

function isEmailDomainAllowed(domain) {
  const d = domain.toLowerCase();
  if (EMAIL_ALLOWED_BASE.some((a) => d === a || d.endsWith("." + a))) return true;
  return EMAIL_ALLOWED_SUFFIX.some((s) => d.endsWith(s));
}

function scanEmail(text, opts) {
  const out = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const at = m[0].indexOf("@");
    const local = m[0].slice(0, at);
    const domain = m[0].slice(at + 1);
    if (isEmailDomainAllowed(domain)) continue;
    if (local === "git" && isHostAllowed(domain, opts)) continue;
    out.push({ pattern: "email", start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return out;
}

const HOME_POSIX_RE = /\/(?:Users|home)\/([A-Za-z0-9._-]+)/g;
const HOME_DRIVE_RE = /[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)([A-Za-z0-9._-]+)/g;
const HOME_TILDE_RE = /~[a-z][a-z0-9._-]*\//gi;

function scanHomePath(text) {
  const out = [];
  const add = (m) => out.push({ pattern: "home-path", start: m.index, end: m.index + m[0].length, match: m[0] });
  for (const m of text.matchAll(HOME_DRIVE_RE)) {
    if (m[1] === "Public" || m[1] === "Default") continue;
    add(m);
  }
  const drive = [...out];
  for (const m of text.matchAll(HOME_POSIX_RE)) {
    if (m[1] === "Shared") continue;
    const span = { start: m.index, end: m.index + m[0].length };
    if (drive.some((d) => overlaps(d, span))) continue;
    add(m);
  }
  for (const m of text.matchAll(HOME_TILDE_RE)) add(m);
  return out;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function position(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

function scanSpans(text, opts) {
  const o = normalizeOpts(opts);
  const emails = scanEmail(text, o);
  const all = [...emails, ...scanHomePath(text, o)];
  return all.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function scanText(text, opts = {}) {
  const starts = lineStarts(text);
  return scanSpans(text, opts).map(({ start, end, ...f }) => ({ ...f, ...position(starts, start) }));
}

export function maskMatch(m) {
  return m.slice(0, 2) + "…";
}

export function maskText(text, opts = {}) {
  const spans = scanSpans(text, opts).sort((a, b) => b.start - a.start);
  let out = text;
  let limit = Infinity;
  for (const s of spans) {
    if (s.end > limit) continue;
    out = out.slice(0, s.start) + maskMatch(s.match) + out.slice(s.end);
    limit = s.start;
  }
  return out;
}
