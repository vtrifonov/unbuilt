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
