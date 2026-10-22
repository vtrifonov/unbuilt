import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, maskMatch, maskText, isHostAllowed, DEFAULT_ALLOW_HOSTS } from "../scripts/lib/redaction.mjs";
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
test("maskText masks the union of overlapping findings (nested secret)", () => {
  const withEmail = A("to", "ken=") + "ab12@widgets-intranet.com/x9QzTailVal";
  assert.ok(scanText(withEmail).length >= 2);
  const m1 = maskText(withEmail);
  assert.equal(m1, "to…");
  for (const part of ["ab12", "widgets", "x9Qz", "TailVal"]) assert.ok(!m1.includes(part), part);
  const withIp = "see " + A("pass", "word=") + "10.20.30.40QzTailVal end";
  assert.deepEqual(scanText(withIp).map((f) => f.pattern).sort(), ["ipv4", "secret"]);
  const m2 = maskText(withIp);
  assert.equal(m2, "see pa… end");
  for (const part of ["10.20", "30.40", "QzTailVal"]) assert.ok(!m2.includes(part), part);
});
test("generic credential keys after _ or - and JSON-quoted keys (assembled)", () => {
  const positives = [
    A("DB_PASS", "WORD=") + "Summer" + "2026" + ".Admin",
    A("access_to", "ken = ") + "a1b2c3" + "d4e5f6g7",
    A("client_sec", "ret: ") + "a1b2c3" + "d4e5f6g7",
    '{"' + A("pass", "word") + '": "' + "Summer" + "2026" + '.Admin"}',
  ];
  for (const t of positives) assert.equal(hits(t, "secret").length, 1, t.slice(0, 10));
  assert.equal(hits("mypassword=" + "Summer" + "2026" + ".Admin", "secret").length, 0);
});
test("key-suffixed credential names and Bearer tokens are secrets (amendment 7b, assembled)", () => {
  const v = ["a1B2", "c3D4", "e5F6", "g7H8"].join("");
  const positives = [
    A("SECRET", "_KEY = '") + "django-insecure-" + v + "'",
    A("aws_secret_", "access_key = ") + v + "/" + v,
    A("AWS_SECRET_", "ACCESS_KEY=") + v + v,
    A("private", "_key: ") + v,
    A("Authorization: Bea", "rer ") + v + v,
  ];
  for (const t of positives) assert.equal(hits(t, "secret").length, 1, t.slice(0, 14));
  const negatives = ["Authorization: Bearer <token>", "Authorization: Bearer YOUR_ACCESS_TOKEN_GOES_HERE", "Bearer " + "a1b2c3d4", "SECRET_KEY = os.environ['DJANGO_SECRET_KEY']",
    "private_key: <path-to-key>", "aws_secret_access_key = $AWS_SECRET", "access_key: REPLACE_WITH_YOUR_KEY", "mysecret_key=" + v];
  for (const t of negatives) assert.equal(hits(t, "secret").length, 0, t);
});
test("ipv6 at the end of a sentence", () => {
  const h = hits("Connects to fd12:3456:789a::1.", "ipv6");
  assert.equal(h.length, 1);
  assert.equal(h[0].match, "fd12:3456:789a::1");
  for (const t of ["std::vector.", "Add::Face.", "at 12:30:45.", "fd12:3456:789a::1.x"]) assert.equal(hits(t, "ipv6").length, 0, t);
});
test("url with userinfo yields one hostname finding on the host", () => {
  const f = scanText("https://alice@build01.widgets-intranet.com/");
  assert.deepEqual(f.map((x) => x.pattern), ["hostname"]);
  assert.equal(f[0].match, "build01.widgets-intranet.com");
  assert.equal(f[0].column, 15);
  assert.deepEqual(scanText("https://alice@github.com/x"), []);
});
test("url authority: password userinfo is a secret, host is after the last @ with the port stripped", () => {
  const pw = ["pw", "12345678"].join("");
  const a = scanText(`https://user:${pw}@build01.widgets-intranet.com/`);
  assert.deepEqual(a.map((x) => x.pattern), ["secret", "hostname"]);
  assert.equal(a[0].match, `user:${pw}`); assert.equal(a[0].column, 9);
  assert.equal(a[1].match, "build01.widgets-intranet.com");
  assert.equal(maskText(`https://user:${pw}@build01.widgets-intranet.com/`), "https://us…@bu…/");
  const b = scanText(`https://user:${pw}@grafana/x`);
  assert.deepEqual(b.map((x) => [x.pattern, x.match]), [["secret", `user:${pw}`], ["hostname", "grafana"]]);
  assert.equal(maskText(`https://user:${pw}@grafana/x`), "https://us…@gr…/x");
  const c = scanText("https://alice@build01.widgets-intranet.com:8443/");
  assert.deepEqual(c.map((x) => [x.pattern, x.match, x.column]), [["hostname", "build01.widgets-intranet.com", 15]]);
  assert.deepEqual(scanText(`https://user:${pw}@github.com/x`).map((x) => x.pattern), ["secret"]);
});
test("placeholder userinfo passwords are not secrets", () => {
  for (const t of ["postgresql://postgres:postgres@localhost:5432/app", "postgres://user:password@localhost/db", "https://${USER}:${PASS}@github.com/o/r", "mongodb://<user>:<password>@localhost/db"]) {
    assert.equal(hits(t, "secret").length, 0, t);
  }
  const pw = ["pw", "12345678"].join("");
  assert.equal(hits(`postgres://user:${pw}@localhost/db`, "secret").length, 1);
});
test("url host stops at quotes, brackets and parentheses", () => {
  for (const t of ["[repo](https://github.com)", '<a href="https://github.com">GitHub</a>', '{"u": "https://github.com"}']) {
    assert.deepEqual(scanText(t), [], t);
  }
  const h = hits("[x](https://build01.widgets-intranet.com)", "hostname");
  assert.equal(h.length, 1);
  assert.equal(h[0].match, "build01.widgets-intranet.com");
});
test("a token in url userinfo yields one secret finding", () => {
  const value = ["Ab12", "Cd34", "Ef56", "Gh78"].join("");
  const t = `https://x-access-token:${value}@github.com/o/r.git`;
  assert.equal(hits(t, "secret").length, 1);
  assert.ok(!maskText(t).includes(value));
});
test("leak scanning is linear: a 1 MB single-token run of each hot class scans under 2 s (security review finding 1)", () => {
  const n = 1048576;
  const run = (unit, tail = "") => unit.repeat(Math.ceil(n / unit.length)).slice(0, n) + tail;
  const cases = {
    "email local part": run("a"),
    "dotted run": run("a.", "!"),
    "email domain": "x@" + run("a-"),
    "url scheme plus": run("a+"),
    "url scheme dotted": run("a.", "x"),
    "ipv6 colons": run(":", "g"),
    "ipv6 hex colon": run("a:", "g"),
    "ipv6 digit colon": run("1:", ".x"),
    "jwt body": "eyJ" + run("a", "."),
    "base64-ish": run("QUJD+/09"),
  };
  for (const [name, text] of Object.entries(cases)) {
    const t0 = performance.now();
    scanText(text);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${name}: ${ms.toFixed(0)} ms`);
  }
});
test("isHostAllowed normalises and unions with defaults", () => {
  assert.equal(isHostAllowed("github.com", { allowHosts: ["acme.com"], exactHosts: [] }), true);
  assert.equal(isHostAllowed("vpn.acme.com", { allowHosts: ["ACME.com"], exactHosts: [] }), true);
  assert.equal(isHostAllowed("Tool.Example-Public.org", { allowHosts: [], exactHosts: ["tool.EXAMPLE-public.org"] }), true);
  assert.equal(isHostAllowed("other.widgets.com", { allowHosts: ["acme.com"], exactHosts: [] }), false);
});
