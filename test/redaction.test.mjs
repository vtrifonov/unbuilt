import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, maskMatch, maskText, DEFAULT_ALLOW_HOSTS } from "../scripts/lib/redaction.mjs";
const hits = (text, pattern, opts) => scanText(text, opts).filter((f) => f.pattern === pattern);

test("email positives", () => {
  for (const t of ["Contact alice@widgets-intranet.com.", "mail bob.smith+x@mail.corp-widgets.net now", "ops@widgets-intranet.com"]) {
    assert.equal(hits(t, "email").length, 1, t);
  }
});
test("email negatives", () => {
  for (const t of ["user@example.com", "a@sub.example.org", "x@widgets.example", "y@host.test", "git@github.com:vtrifonov/clipjar.git", "no at sign here"]) {
    assert.equal(hits(t, "email").length, 0, t);
  }
});
test("home-path positives", () => {
  const cases = [["Stored in /Users/alice/data.", "/Users/alice"], ["/home/bob/.config", "/home/bob"],
    ['"C:\\\\Users\\\\alice\\\\AppData"', "C:\\\\Users\\\\alice"], ["C:/Users/alice/x", "C:/Users/alice"],
    ["~alice/projects", "~alice/"], ["~Alice/projects", "~Alice/"], ["route /home/settings", "/home/settings"]];
  for (const [t, m] of cases) { const h = hits(t, "home-path"); assert.equal(h.length, 1, t); assert.equal(h[0].match, m); }
});
test("home-path negatives", () => {
  for (const t of ["~/Library/Application Support/Clipjar", "/Users/Shared", "$HOME/.config", "C:\\Users\\Public", "C:\\Users\\Default", "~/projects"]) {
    assert.equal(hits(t, "home-path").length, 0, t);
  }
});
test("line and column are 1-based", () => {
  const f = scanText("ok\nsee alice@widgets-intranet.com")[0];
  assert.equal(f.line, 2); assert.equal(f.column, 5);
});
test("maskMatch and maskText", () => {
  assert.equal(maskMatch("alice@widgets-intranet.com"), "al…");
  assert.equal(maskText("name: alice@widgets-intranet.com here"), "name: al… here");
});
test("DEFAULT_ALLOW_HOSTS content (R-VAL-25)", () => {
  for (const h of ["example.com", "example.org", "example.net", "localhost", "github.com", "githubusercontent.com", "npmjs.com", "pypi.org", "crates.io", "w3.org", "schema.org", "purl.org", "ns.adobe.com", "iptc.org", "ns.useplus.org"]) assert.ok(DEFAULT_ALLOW_HOSTS.includes(h), h);
});
test("ipv4 positives", () => {
  for (const t of ["Connects to 10.20.30.40.", "host 172.16.5.9", "192.168.1.1", "1.1.1.1", "8.8.4.4 resolver"]) assert.equal(hits(t, "ipv4").length, 1, t);
});
test("ipv4 negatives", () => {
  for (const t of ["127.0.0.1", "127.255.0.9", "0.0.0.0", "255.255.255.255", "192.0.2.10", "198.51.100.7", "203.0.113.200",
    "1.2.3.4.5", "v2.1.0.0", "CFBundleVersion 2.1.0.0", "CFBundleVersion: 2.1.0.0", '"version": "2.1.0.0"', "version=2.1.0.0", "see section 3.1.2.4", "§3.1.2.4", "256.1.1.1"]) {
    assert.equal(hits(t, "ipv4").length, 0, t);
  }
});
test("ipv4 exact host allow", () => {
  assert.equal(hits("resolver 1.1.1.1", "ipv4", { exactHosts: ["1.1.1.1"] }).length, 0);
  assert.equal(hits("resolver 1.1.1.2", "ipv4", { exactHosts: ["1.1.1.1"] }).length, 1);
});
test("ipv6 positives", () => {
  const cases = [["fd12:3456:789a::1", undefined], ["link fe80::1%en0 up", undefined], ["2a02:1234:5678:9abc:def0:1234:5678:9abc", undefined], ["mac 00:1a:2b:3c:4d:5e", "mac"]];
  for (const [t, kind] of cases) { const h = hits(t, "ipv6"); assert.equal(h.length, 1, t); assert.equal(h[0].kind, kind); }
});
test("ipv6 negatives", () => {
  for (const t of ["::1", "2001:db8::1", "2001:0db8:85a3::8a2e:0370:7334", "std::vector", "Add::Face", "a::b", "12:30", "12:30:45", "01:02:03:04", "at 09:15 today", "ab:cd::"]) {
    assert.equal(hits(t, "ipv6").length, 0, t);
  }
});
test("hostname positives", () => {
  const cases = [["Served from build01.widgets-intranet.com.", "build01.widgets-intranet.com"], ["db.corp.internal", "db.corp.internal"],
    ["https://billing-abc123-ew.a.run.app/api", "billing-abc123-ew.a.run.app"], ["http://grafana:3000/d/x", "grafana"], ["https://wiki/", "wiki"],
    ["http://nas.local/share", "nas.local"], ["see Widgets.IO today", "Widgets.IO"], ["box.lan", "box.lan"]];
  for (const [t, m] of cases) { const h = hits(t, "hostname"); assert.equal(h.length, 1, t); assert.equal(h[0].match, m); }
});
test("hostname negatives", () => {
  for (const t of ["Clipjar.app", "SKILL.md", "GRDB.swift", "UTF-8", "clip.id", "user.id", "model.pt", "logo.ai", "see `settings.local.json`", "chrome.storage.local", "user.home", "Key.home",
    '<svg xmlns="http://www.w3.org/2000/svg">', "https://github.com/vtrifonov/clipjar", "git@github.com:vtrifonov/clipjar.git", "user@example.com", "docs.example.org", "file:///tmp/x", "http://127.0.0.1:8080/", "http://[::1]/"]) {
    assert.equal(hits(t, "hostname").length, 0, t);
  }
});
test("hostname allow options", () => {
  const opts = { exactHosts: ["tool.example-public.org"] };
  assert.equal(hits("tool.example-public.org", "hostname", opts).length, 0);
  assert.equal(hits("ci.tool.example-public.org", "hostname", opts).length, 1);
  assert.equal(hits("vpn.acme-widgets.com", "hostname", { allowHosts: ["acme-widgets.com"] }).length, 0);
});
test("no double report between email and hostname (R-VAL-28)", () => {
  const f = scanText("alice@build01.widgets-intranet.com");
  assert.deepEqual(f.map((x) => x.pattern), ["email"]);
  const g = scanText("https://build01.widgets-intranet.com/x");
  assert.deepEqual(g.map((x) => x.pattern), ["hostname"]);
});
const A = (p, body) => p + body;               // assemble at runtime (R-TST-9)
const alnum36 = "a1".repeat(18);               // 36 chars with digits
test("secret positives (assembled)", () => {
  const positives = [
    "key = AKIAIOSFODNN7EXAMPLE",
    A("AS", "IA") + "ABCDEFGHIJKLMN12",
    A("gh", "p_") + alnum36, A("gh", "o_") + alnum36, A("gh", "s_") + alnum36,
    A("github_", "pat_") + "a1".repeat(12),
    A("sk", "-") + "a1".repeat(12), A("sk_", "live_") + "a1b2c3d4e5f6", A("rk_", "live_") + "a1b2c3d4e5f6", A("sk_", "test_") + "a1b2c3d4e5f6",
    A("xox", "b-") + "1234-abcd-5678", A("xox", "e-") + "1234-abcd-5678", A("xox", "r-") + "1234-abcd-5678", A("xox", "s-") + "1234-abcd-5678", A("xap", "p-") + "1234-abcd-5678",
    A("AI", "za") + "A1".repeat(17) + "A",
    A("gl", "pat-") + "a1".repeat(11),
    A("np", "m_") + alnum36,
    A("ey", "J") + "a1".repeat(6) + "." + "b2".repeat(6) + "." + "c3".repeat(6),
    "-----BEGIN " + "RSA PRIVATE KEY" + "-----",
    // Generic credential assignments, assembled at runtime so no complete `password: …` line is committed (R-TST-9).
    A("pass", "word: ") + "hunter2" + "hunter2",
    A("api_", "key = ") + "9f8e7d" + "6c5b4a",
    A("pass", "word: ") + "Summer" + "2026" + ".Admin",
    A("to", "ken: ") + "QUJD1".repeat(3) + "." + "REVG2".repeat(3) + "." + "R0hJ3".repeat(3),
  ];
  for (const t of positives) assert.equal(hits(t, "secret").length, 1, t.slice(0, 12));
});
test("secret negatives", () => {
  for (const t of ["password: <your-password>", "token: the-api-token", "api_key: YOUR_API_KEY", "password = REPLACE_ME", "secret: Optional<String>", "Secret: Keychain",
    "const token = line.slice(start);", "let secret = /-----BEGIN/", "password: ********", "token = $TOKEN_FROM_ENV", "AKIA short", "sk-short", "secret: 1234567"]) {
    assert.equal(hits(t, "secret").length, 0, t);
  }
});
