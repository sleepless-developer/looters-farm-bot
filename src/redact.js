const SECRET_KEY_RE = /cookie|token|auth|session|secret|signature|jwt|bearer|password|private|email|avatar|authorization/i;

export function isSensitiveKey(key) {
  return SECRET_KEY_RE.test(String(key));
}

export function redact(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const primitiveSafe = typeof child === "boolean" || typeof child === "number" || child == null;
      out[key] = isSensitiveKey(key) && !primitiveSafe ? "[REDACTED]" : redact(child);
    }
    return out;
  }
  if (typeof value === "string" && /^(bearer|eyJ|[A-Za-z0-9+/=._-]{32,})/i.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

export function safeLogObject(value) {
  return JSON.stringify(redact(value), null, 2);
}
