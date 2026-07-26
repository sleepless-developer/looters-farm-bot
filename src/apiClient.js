import { API_ORIGIN, API_PATH, SAFE_GET_ACTIONS, SAFE_POST_ACTIONS } from "./constants.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export function classifyNetworkError(error) {
  const cause = error?.cause ?? error;
  const code = String(cause?.code ?? error?.code ?? cause?.name ?? error?.name ?? "").trim();
  const message = sanitizeNetworkMessage(cause?.message ?? error?.message ?? "unknown network error");
  const text = `${code} ${message}`.toLowerCase();

  let category = "network";
  if (error?.name === "AbortError") category = "timeout";
  else if (text.includes("407") || text.includes("proxy authentication")) category = "proxy-auth";
  else if (text.includes("connect") && text.includes("timeout")) category = "proxy-connect-timeout";
  else if (text.includes("econnrefused")) category = "proxy-refused";
  else if (text.includes("enotfound")) category = "dns";
  else if (text.includes("econnreset") || text.includes("socket")) category = "proxy-socket";
  else if (text.includes("certificate") || text.includes("tls")) category = "tls";
  else if (String(error?.message ?? "").toLowerCase() === "fetch failed") category = "fetch-failed";

  return {
    category,
    code: code || null,
    message,
  };
}

export function safeErrorSummary(error) {
  return {
    category: error?.safeCategory ?? classifyNetworkError(error).category,
    code: error?.safeCode ?? classifyNetworkError(error).code,
    message: sanitizeNetworkMessage(error?.message ?? String(error ?? "unknown error")),
  };
}

function sanitizeNetworkMessage(message) {
  return String(message ?? "unknown error")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/proxy-authorization\s*:\s*\S+/gi, "proxy-authorization:[REDACTED]")
    .replace(/[A-Za-z0-9+/=._-]{48,}/g, "[REDACTED]")
    .slice(0, 260);
}

export class LootersApiClient {
  constructor({ cookie, origin = API_ORIGIN, proxyUrl = null, timeoutMs = 30000 } = {}) {
    if (!cookie || typeof cookie !== "string") {
      throw new Error("Missing Looters session cookie. Run: node src/cli.js vault set-cookie");
    }
    this.cookie = cookie.trim();
    this.origin = origin;
    this.proxyUrl = proxyUrl || null;
    this.dispatcher = this.proxyUrl ? new ProxyAgent(this.proxyUrl) : undefined;
    this.timeoutMs = timeoutMs;
  }

  async get(action) {
    if (!SAFE_GET_ACTIONS.has(action)) throw new Error(`Unsafe GET action blocked: ${action}`);
    return this.#request("GET", action);
  }

  async post(action, body = {}) {
    if (!SAFE_POST_ACTIONS.has(action)) throw new Error(`Unsafe POST action blocked: ${action}`);
    return this.#request("POST", action, body);
  }

  async #request(method, action, body) {
    const url = new URL(API_PATH, this.origin);
    url.searchParams.set("action", action);
    const headers = {
      "Accept": "application/json",
      "Cookie": this.cookie,
      "X-Requested-With": "fetch",
      "User-Agent": "looters-farm-bot/0.1",
    };
    const init = {
      method,
      headers,
      redirect: "manual",
    };
    if (this.dispatcher) init.dispatcher = this.dispatcher;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    init.signal = controller.signal;

    let response;
    try {
      response = await undiciFetch(url, init);
    } catch (error) {
      const info = classifyNetworkError(error);
      const wrapped = new Error(`Looters API ${info.category} for action=${action}${info.code ? `; code=${info.code}` : ""}`);
      wrapped.safeCategory = info.category;
      wrapped.safeCode = info.code;
      wrapped.cause = error;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect blocked for action=${action}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Non-JSON response blocked for action=${action}; content-type=${contentType || "unknown"}`);
    }
    const json = await response.json();
    if (!response.ok || json?.ok === false) {
      const safeError = typeof json?.error === "string" ? json.error : `HTTP ${response.status}`;
      throw new Error(`Looters API error for action=${action}: ${safeError}`);
    }
    return json;
  }
}
