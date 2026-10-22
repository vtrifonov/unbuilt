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
