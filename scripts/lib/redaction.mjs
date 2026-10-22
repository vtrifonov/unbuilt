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
  return hostAllowedNormalized(host, normalizeOpts(opts));
}

function hostListed(h, o) {
  if (o.exactHosts.includes(h)) return true;
  return o.allowHosts.some((a) => h === a || h.endsWith("." + a));
}

// Internal fast path: `o` must already come from normalizeOpts. A non-ASCII host is also compared in its
// punycode form, the form `new URL` gives a reference_impl host (amendment 8g). The retry runs only on a plain
// label sequence and must keep the label count, because the URL parser treats "\" as a path separator and
// would turn "github.com\ü.widgets-intranet.com" into "github.com".
const IDN_HOST_RE = /^[\p{L}\p{M}\p{N}.-]+$/u;
function hostAllowedNormalized(host, o) {
  const h = host.toLowerCase();
  if (hostListed(h, o)) return true;
  if (!/[^\x00-\x7f]/.test(h) || !IDN_HOST_RE.test(h)) return false;
  let puny;
  try { puny = new URL("http://" + h).hostname; } catch { return false; }
  return puny !== h && puny.split(".").length === h.split(".").length && hostListed(puny, o);
}

// Overlap tests against a set of spans go through an offset mask, so each test costs the length of the tested
// span rather than the number of spans; with disjoint tested spans a whole pass stays linear in the text.
function spanMask(length, spans) {
  const mask = new Uint8Array(length);
  for (const s of spans) mask.fill(1, s.start, s.end);
  return mask;
}
function masked(mask, span) {
  for (let i = span.start; i < span.end; i++) if (mask[i] === 1) return true;
  return false;
}

// Every scan regex is linear in the input: a match may start only at the beginning of a run of its
// character class (left-boundary lookbehind), so an interior position fails in constant time.
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
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
    if (local === "git" && hostAllowedNormalized(domain, opts)) continue;
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
  const drive = spanMask(text.length, out);
  for (const m of text.matchAll(HOME_POSIX_RE)) {
    if (m[1] === "Shared") continue;
    if (masked(drive, { start: m.index, end: m.index + m[0].length })) continue;
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

// Unambiguous form of "hex and colons with at least one colon"; an address with a zone index is under 64 characters.
const IPV6_CANDIDATE_RE = /(?<![\w:.])(?:[0-9a-f]*:)+[0-9a-f]*(?:%[a-z0-9]+)?(?![\w:]|\.[\w])/gi;
const IPV6_MAX_CANDIDATE = 64;

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
    if (m[0].length > IPV6_MAX_CANDIDATE) continue;
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
// The scheme is bounded to 32 characters, so each start costs at most 32 steps and `_`, `-`, `.` or `+`
// before a scheme never blocks a match (amendment 7c revised).
const URL_HOST_RE = /(?<![A-Za-z0-9])[a-z][a-z0-9+.-]{0,31}:\/\/([^/\s?#\[\]"'<>()`]+)/gi;
const IPV4_FULL_RE = new RegExp(`^${IPV4_RE.source}$`);

// Sentence punctuation and emphasis markers after a URL are not part of its authority (amendment 8g).
// A backward scan, not a `[...]+$` regex, which would be quadratic on a long punctuation run.
const AUTHORITY_TRAILERS = new Set([".", ",", ";", ":", "!", "?", "*", "_", "~"]);
function stripTrailers(s) {
  let end = s.length;
  while (end > 0 && AUTHORITY_TRAILERS.has(s[end - 1])) end--;
  return s.slice(0, end);
}

// URL authorities (userinfo@host:port): the host is the part after the last "@" with any ":port" stripped.
// A userinfo carrying a non-placeholder password ("user:password") is kept so it can be reported as a secret.
function urlAuthorities(text) {
  const out = [];
  for (const m of text.matchAll(URL_HOST_RE)) {
    const start = m.index + m[0].length - m[1].length;
    const authority = stripTrailers(m[1]);
    const at = authority.lastIndexOf("@");
    const hostPort = authority.slice(at + 1);
    const colon = hostPort.indexOf(":");
    const host = colon < 0 ? hostPort : hostPort.slice(0, colon);
    const hostStart = start + at + 1;
    const userinfo = at < 0 ? "" : authority.slice(0, at);
    const sep = userinfo.indexOf(":");
    const hasPassword = sep >= 0 && sep < userinfo.length - 1 && !isPlaceholderValue(userinfo.slice(sep + 1));
    const password = hasPassword ? { start, end: start + at, match: userinfo } : null;
    out.push({ start, end: start + authority.length, host, hostStart, password });
  }
  return out;
}

function scanUserinfoSecret(authorities) {
  return authorities.filter((a) => a.password).map((a) => ({ pattern: "secret", ...a.password }));
}

function scanHostname(text, opts, emailSpans, authorities) {
  const out = [];
  for (const a of authorities) {
    const { host } = a;
    if (!host || IPV4_FULL_RE.test(host) || host.startsWith("[")) continue;
    if (hostAllowedNormalized(host, opts)) continue;
    out.push({ pattern: "hostname", start: a.hostStart, end: a.hostStart + host.length, match: host });
  }
  const taken = spanMask(text.length, [...authorities, ...emailSpans]);
  for (const m of text.matchAll(BARE_HOST_RE)) {
    const span = { start: m.index, end: m.index + m[0].length };
    if (masked(taken, span)) continue;
    if (hostAllowedNormalized(m[1], opts)) continue;
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
// Up to four identifier words, then a name that ends in a credential noun (SECRET_KEY, aws_secret_access_key,
// client_secret; not tokenizer or secret_name), then ":" or "=" and the value (amendment 7b revised).
const GENERIC_SECRET_RE = /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-]){0,4}(?:pass(?:word|wd)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|secret[_-]?key)["']?\s*[:=]\s*["']?([^\s"'<>]{8,})/gi;
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/-]{20,})/g;
const BEARER_HEADER_RE = /(?:Authorization:\s*|["'`])$/i;
const hasDigitAndLetter = (s) => /\d/.test(s) && /[A-Za-z]/.test(s);

// A Bearer value counts only in a header context (Authorization:, or a quote or backtick before "Bearer"),
// or when each half of the value has a digit and a letter, so prose naming a versioned auth scheme passes.
function isBearerSecret(text, m) {
  if (BEARER_HEADER_RE.test(text.slice(Math.max(0, m.index - 64), m.index))) return true;
  const half = m[1].length >> 1;
  return hasDigitAndLetter(m[1].slice(0, half)) && hasDigitAndLetter(m[1].slice(half));
}

function isPlaceholderValue(v) {
  if (v.startsWith("<") || v.startsWith("$")) return true;
  if (/^[a-z]+([-_][a-z]+)*$/.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  if (!/\d/.test(v)) return true;
  return /[(<[]/.test(v);
}

function scanSecret(text, seeded = []) {
  const found = [...seeded];
  for (const re of SECRET_SHAPES) {
    for (const m of text.matchAll(re)) found.push({ pattern: "secret", start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  for (const re of [GENERIC_SECRET_RE, BEARER_RE]) {
    for (const m of text.matchAll(re)) {
      if (isPlaceholderValue(m[1])) continue;
      if (re === BEARER_RE && !isBearerSecret(text, m)) continue;
      found.push({ pattern: "secret", start: m.index, end: m.index + m[0].length, match: m[0] });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  // Kept spans are disjoint and sorted, so a candidate overlaps one of them only if it starts before the last end.
  const out = [];
  for (const f of found) if (out.length === 0 || f.start >= out[out.length - 1].end) out.push(f);
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
  const authorities = urlAuthorities(text);
  // A userinfo@host inside a URL authority is reported once, as the hostname.
  const inAuthority = spanMask(text.length, authorities);
  const emails = scanEmail(text, o).filter((e) => !masked(inAuthority, e));
  const all = [...emails, ...scanHomePath(text, o), ...scanIpv4(text, o), ...scanIpv6(text, o), ...scanHostname(text, o, emails, authorities), ...scanSecret(text, scanUserinfoSecret(authorities))];
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
  // Merge overlapping findings into their union so no part of an outer span survives a nested one.
  const merged = [];
  for (const s of scanSpans(text, opts)) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ start: s.start, end: s.end });
  }
  let out = text;
  for (const s of merged.reverse()) out = out.slice(0, s.start) + maskMatch(text.slice(s.start, s.end)) + out.slice(s.end);
  return out;
}
