import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.js";
import { looksLikeCookieHeader, looksLikeProxyUrl, maskProxyUrl, normalizeCookieHeader, normalizeProxyUrl } from "../src/vault.js";

test("redactor masks secret-bearing keys recursively", () => {
  const safe = redact({
    ok: true,
    cookie: "session=secret",
    nested: {
      authorization: "Bearer abc",
      loot: 10,
    },
  });
  assert.equal(safe.cookie, "[REDACTED]");
  assert.equal(safe.nested.authorization, "[REDACTED]");
  assert.equal(safe.nested.loot, 10);
});

test("redactor keeps safe primitive status flags readable", () => {
  const safe = redact({ hasSessionCookie: false, auth: false });
  assert.equal(safe.hasSessionCookie, false);
  assert.equal(safe.auth, false);
});

test("source safety invariant: no antibot DOM dependency", async () => {
  const modules = [
    "../src/apiClient.js",
    "../src/cli.js",
    "../src/constants.js",
    "../src/har.js",
    "../src/lock.js",
    "../src/notify.js",
    "../src/strategy.js",
    "../src/worker.js",
  ];
  for (const modulePath of modules) {
    const url = new URL(modulePath, import.meta.url);
    const text = await import("node:fs/promises").then((fs) => fs.readFile(url, "utf8"));
    assert.equal(text.includes(".antibot"), false);
    assert.equal(text.includes('class="antibot"'), false);
  }
});

test("cookie helper accepts request Cookie header forms", () => {
  assert.equal(normalizeCookieHeader("Cookie: PHPSESSID=abc; other=value"), "PHPSESSID=abc; other=value");
  assert.equal(looksLikeCookieHeader("Cookie: PHPSESSID=abc; other=value"), true);
  assert.equal(looksLikeCookieHeader("PHPSESSID=abc"), true);
  assert.equal(normalizeCookieHeader("PHPSESSID abc123 lootersnft.xyz / 2026-08-23T00:00:00.000Z"), "PHPSESSID=abc123");
  assert.equal(looksLikeCookieHeader("PHPSESSID abc123 lootersnft.xyz / 2026-08-23T00:00:00.000Z"), true);
  assert.equal(looksLikeCookieHeader("abc-only-value"), false);
});

test("proxy helper accepts only host-only http/https proxy urls and masks auth", () => {
  assert.equal(normalizeProxyUrl("http://user:pass@proxy.example"), "http://user:pass@proxy.example/");
  assert.equal(normalizeProxyUrl("http://192.0.2.10:6271:name:pass:"), "http://user:pass@proxy.example/");
  assert.equal(normalizeProxyUrl("192.0.2.10:6271:name:pass"), "http://user:pass@proxy.example/");
  assert.equal(maskProxyUrl("http://user:pass@proxy.example"), "http://user:pass@proxy.example");
  assert.equal(maskProxyUrl("https://proxy.example:8443"), "https://proxy.example:8443");
  assert.equal(looksLikeProxyUrl("socks5://user:pass@127.0.0.1:1080"), false);
  assert.equal(looksLikeProxyUrl("http://127.0.0.1:8080/path"), false);
});
