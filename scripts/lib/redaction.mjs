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

export const IPV4_RE = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\.?\d)/g;
const IPV4_VERSION_PREFIX_RE = /(v|version["']?\s*[:=]?\s*["']?|section |§)$/i;

function isIpv4Allowed(addr, opts) {
  if (addr.startsWith("127.")) return true;
  if (addr === "0.0.0.0" || addr === "255.255.255.255") return true;
  if (["192.0.2.", "198.51.100.", "203.0.113."].some((p) => addr.startsWith(p))) return true;
  return opts.exactHosts.includes(addr);
}

function scanIpv4(text, opts) {
  const out = [];
  for (const m of text.matchAll(IPV4_RE)) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (IPV4_VERSION_PREFIX_RE.test(before)) continue;
    if (isIpv4Allowed(m[0], opts)) continue;
    out.push({ pattern: "ipv4", start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return out;
}

const IPV6_CANDIDATE_RE = /(?<![\w:.])[0-9a-f:]*:[0-9a-f:]*(?:%[a-z0-9]+)?(?![\w:.])/gi;

function classifyIpv6(candidate) {
  const addr = candidate.split("%")[0];
  if (addr.split("::").length - 1 > 1) return null;
  const groups = addr.split(":").filter((g) => g !== "");
  if (groups.some((g) => g.length < 1 || g.length > 4)) return null;
  const compressed = addr.includes("::");
  if (compressed) {
    if (groups.some((g) => /\d/.test(g)) || groups.length >= 3) return { addr, groups };
    return null;
  }
  if (groups.length === 8) return { addr, groups };
  if (groups.length === 6 && groups.every((g) => g.length === 2)) return { addr, groups, kind: "mac" };
  return null;
}

function scanIpv6(text, opts) {
  const out = [];
  for (const m of text.matchAll(IPV6_CANDIDATE_RE)) {
    const c = classifyIpv6(m[0]);
    if (!c) continue;
    const addr = c.addr.toLowerCase();
    if (addr === "::1") continue;
    if (c.groups[0] === "2001" && ["db8", "0db8"].includes(c.groups[1]?.toLowerCase())) continue;
    if (opts.exactHosts.includes(addr) || opts.exactHosts.includes(m[0].toLowerCase())) continue;
    const f = { pattern: "ipv6", start: m.index, end: m.index + m[0].length, match: m[0] };
    if (c.kind) f.kind = c.kind;
    out.push(f);
  }
  return out;
}

export const TLDS = [
  "com", "net", "org", "io", "dev", "co", "info", "biz", "cloud", "tech", "xyz", "site", "online", "page",
  "uk", "de", "fr", "nl", "eu", "bg", "ca", "au", "ch", "se", "fi", "dk", "es", "ie", "cz", "ro", "gr",
  "jp", "cn", "kr", "br", "mx", "nz", "za", "ru", "ua", "tr", "il", "sg", "hk", "tw", "vn", "ly", "gg", "tv", "fm",
  "internal", "lan", "corp", "intranet", "arpa",
];
const BARE_HOST_RE = new RegExp(`(?<![@\\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS.join("|")}))(?![\\w-])`, "gi");
const URL_HOST_RE = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s:?#\[\]]+)/gi;
const IPV4_FULL_RE = new RegExp(`^${IPV4_RE.source}$`);

function scanHostname(text, opts, emailSpans) {
  const out = [];
  const urlSpans = [];
  for (const m of text.matchAll(URL_HOST_RE)) {
    const host = m[1];
    const start = m.index + m[0].length - host.length;
    const span = { start, end: start + host.length };
    if (!host || IPV4_FULL_RE.test(host) || host.startsWith("[")) continue;
    urlSpans.push(span);
    if (isHostAllowed(host, opts)) continue;
    out.push({ pattern: "hostname", ...span, match: host });
  }
  const taken = [...urlSpans, ...emailSpans];
  for (const m of text.matchAll(BARE_HOST_RE)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (taken.some((s) => overlaps(s, span))) continue;
    if (isHostAllowed(m[1], opts)) continue;
    out.push({ pattern: "hostname", ...span, match: m[1] });
  }
  return out;
}

export const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]+-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgh[ousr]_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b[rs]k_(live|test)_[A-Za-z0-9]{10,}/g,
  /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g,
  /\bxapp-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
const GENERIC_SECRET_RE = /\b(pass(word|wd)?|secret|token|api[_-]?key)\s*[:=]\s*["']?([^\s"'<>]{8,})/gi;

function isPlaceholderValue(v) {
  if (v.startsWith("<") || v.startsWith("$")) return true;
  if (/^[a-z]+([-_][a-z]+)*$/.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  if (!/\d/.test(v)) return true;
  return /[(<[]/.test(v);
}

function scanSecret(text) {
  const found = [];
  for (const re of SECRET_SHAPES) {
    for (const m of text.matchAll(re)) found.push({ pattern: "secret", start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  for (const m of text.matchAll(GENERIC_SECRET_RE)) {
    if (isPlaceholderValue(m[3])) continue;
    found.push({ pattern: "secret", start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const f of found) if (!out.some((o) => overlaps(o, f))) out.push(f);
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
  const all = [...emails, ...scanHomePath(text, o), ...scanIpv4(text, o), ...scanIpv6(text, o), ...scanHostname(text, o, emails), ...scanSecret(text)];
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
