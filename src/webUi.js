import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeLogObject } from "./redact.js";
import { LootersApiClient } from "./apiClient.js";
import {
  addSessionProfile,
  appDataDir,
  clearSessionCookie,
  clearMainSessionCookie,
  hasSessionCookie,
  listSessionAccounts,
  listSessionProfiles,
  loadActiveProfileProxyUrl,
  loadMainSessionCookie,
  loadSessionCookie,
  loadSessionProfileCookie,
  loadSessionProfileProxyUrl,
  removeSessionProfile,
  saveMainSessionCookie,
  saveSessionCookie,
  sessionBlobPath,
  setActiveMainSessionProfile,
  setActiveSessionProfile,
  updateSessionProfileCookie,
  updateSessionProfileProxy,
} from "./vault.js";
import { planJewelryHeistBatch } from "./jewelry.js";
import { planCheapestSelectedUpgrade } from "./strategy.js";
import {
  accountAutomationEnabled,
  accountUpgradeEffectTypes,
  accountUpgradeEnabled,
  accountUpgradeSelection,
  loadSettings,
  saveSettings,
  setAccountAutomationEnabled,
  setAccountsAutomationEnabled,
  setAccountUpgradeEffectEnabled,
  settingsPath,
} from "./settings.js";
import { restartWatcher, startWatcher, stopWatcher, watcherStatuses } from "./processManager.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 128 * 1024;
let settingsMutationTail = Promise.resolve();

function mutateSettings(mutator) {
  const mutation = settingsMutationTail.then(async () => {
    const current = await loadSettings();
    return saveSettings(await mutator(current));
  });
  settingsMutationTail = mutation.catch(() => {});
  return mutation;
}

export async function startWebUiServer(options = {}) {
  const host = String(options.host ?? DEFAULT_HOST);
  const port = Number(options.port ?? DEFAULT_PORT);
  const csrfToken = randomBytes(24).toString("hex");

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Web UI may only bind to localhost/loopback.");
  }

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, { csrfToken });
    } catch (error) {
      sendJson(res, error.status ?? 500, { ok: false, error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const url = `http://${host}:${address.port}`;
  console.log(`Looters local UI: ${url}`);
  console.log("Local-only. Cookie values are never displayed.");
  return { server, url, csrfToken };
}

async function handleRequest(req, res, context) {
  const url = new URL(req.url, "http://127.0.0.1");
  setSecurityHeaders(res);

  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, renderIndexHtml(context.csrfToken));
    return;
  }
  if (req.method === "GET" && url.pathname === "/app.css") {
    sendText(res, 200, renderCss(), "text/css; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/app.js") {
    sendText(res, 200, renderClientJs(), "application/javascript; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(res, 200, await buildDashboard());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/settings") {
    sendJson(res, 200, { ok: true, settings: await loadSettings(), settingsPath: await settingsPath() });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/logs/jewelry") {
    sendJson(res, 200, { ok: true, lines: await tailSafeLog("jewelry-runtime.safe.log", 40) });
    return;
  }

  if (req.method === "POST") {
    requireCsrf(req, context.csrfToken);
    const body = await readJsonBody(req);

    if (url.pathname === "/api/settings") {
      const incoming = body.settings ?? body;
      const settings = await mutateSettings((current) => ({
        ...incoming,
        automationByAccount: current.automationByAccount,
        upgradeByAccount: current.upgradeByAccount,
      }));
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    if (url.pathname === "/api/account-upgrade") {
      const settings = await mutateSettings((current) => setAccountUpgradeEffectEnabled(
        current,
        body.accountId,
        body.effectType ?? "suc",
        body.enabled,
      ));
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    if (url.pathname === "/api/account-automation") {
      const settings = await mutateSettings((current) => (
        setAccountAutomationEnabled(current, body.accountId, body.enabled)
      ));
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    if (url.pathname === "/api/accounts-automation") {
      const accounts = await listSessionAccounts();
      const settings = await mutateSettings((current) => (
        setAccountsAutomationEnabled(current, accounts.map((account) => account.id), body.enabled)
      ));
      sendJson(res, 200, { ok: true, settings });
      return;
    }
    if (url.pathname === "/api/cookie/set") {
      await saveSessionCookie(String(body.cookie ?? ""));
      sendJson(res, 200, { ok: true, hasSessionCookie: await hasSessionCookie() });
      return;
    }
    if (url.pathname === "/api/cookie/clear") {
      await clearSessionCookie();
      sendJson(res, 200, { ok: true, hasSessionCookie: false });
      return;
    }
    if (url.pathname === "/api/main/activate") {
      sendJson(res, 200, { ok: true, account: await setActiveMainSessionProfile(), profiles: await listSessionProfiles() });
      return;
    }
    if (url.pathname === "/api/main/cookie") {
      await saveMainSessionCookie(String(body.cookie ?? ""));
      sendJson(res, 200, { ok: true, account: await setActiveMainSessionProfile(), profiles: await listSessionProfiles() });
      return;
    }
    if (url.pathname === "/api/main/clear") {
      await clearMainSessionCookie();
      sendJson(res, 200, { ok: true, account: await setActiveMainSessionProfile(), profiles: await listSessionProfiles() });
      return;
    }
    if (url.pathname === "/api/profiles/add") {
      const profile = await addSessionProfile({
        name: body.name,
        cookie: body.cookie,
        proxy: body.proxy,
        setActive: body.setActive !== false,
      });
      sendJson(res, 200, { ok: true, profile, profiles: await listSessionProfiles() });
      return;
    }

    const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-z0-9_-]+)\/(activate|delete|cookie|proxy)$/i);
    if (profileMatch) {
      const [, id, action] = profileMatch;
      if (action === "activate") {
        sendJson(res, 200, { ok: true, profile: await setActiveSessionProfile(id), profiles: await listSessionProfiles() });
        return;
      }
      if (action === "delete") {
        sendJson(res, 200, { ok: true, removed: await removeSessionProfile(id), profiles: await listSessionProfiles() });
        return;
      }
      if (action === "cookie") {
        sendJson(res, 200, { ok: true, profile: await updateSessionProfileCookie(id, body.cookie), profiles: await listSessionProfiles() });
        return;
      }
      if (action === "proxy") {
        sendJson(res, 200, { ok: true, profile: await updateSessionProfileProxy(id, body.proxy), profiles: await listSessionProfiles() });
        return;
      }
    }

    const watcherMatch = url.pathname.match(/^\/api\/watchers\/(profiles)\/(start|stop|restart)$/);
    if (watcherMatch) {
      const [, target, action] = watcherMatch;
      const settings = await loadSettings();
      const results = [];
      if (action === "start") results.push(await startWatcher(target, settings));
      if (action === "stop") results.push(await stopWatcher(target));
      if (action === "restart") results.push(await restartWatcher(target, settings));
      sendJson(res, 200, { ok: true, results });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

async function buildDashboard() {
  const settings = await loadSettings();
  const statuses = await watcherStatuses();
  const profiles = await listSessionProfiles();
  const accounts = await buildAccountSummaries(profiles, settings);
  const activeAccount = accounts.find((account) => account.active) ?? accounts[0];
  const dashboard = {
    ok: true,
    vault: {
      hasSessionCookie: await hasSessionCookie(),
      path: sessionBlobPath(),
      profiles,
    },
    accounts,
    watchers: {
      gang: pickStatus(statuses.gang),
      jewelry: pickStatus(statuses.jewelry),
      profiles: pickStatus(statuses.profiles),
    },
    settings,
    activity: await buildRecentActivity(),
  };

  dashboard.gameState = activeAccount?.stats ?? { ok: false, reason: "no-active-account" };

  return dashboard;
}

async function buildAccountSummaries(profileState, settings) {
  const accounts = await listSessionAccounts();

  const settled = await Promise.allSettled(accounts.map((account) => readAccountStats(account, settings)));
  return accounts.map((account, index) => ({
    ...account,
    automationEnabled: accountAutomationEnabled(settings, account.id),
    upgradeEnabled: accountUpgradeEnabled(settings, account.id),
    upgradeSelection: accountUpgradeSelection(settings, account.id),
    stats: settled[index].status === "fulfilled"
      ? settled[index].value
      : { ok: false, error: sanitizeError(settled[index].reason?.message ?? settled[index].reason) },
  }));
}

async function readAccountStats(account, settings) {
  if (!account.hasCookie) {
    return { ok: false, reason: "missing-cookie" };
  }

  try {
    const cookie = account.kind === "main"
      ? await loadMainSessionCookie()
      : await loadSessionProfileCookie(account.id);
    const proxyUrl = account.kind === "main" ? null : await loadSessionProfileProxyUrl(account.id);
    const api = new LootersApiClient({ cookie, proxyUrl, timeoutMs: 8000 });
    const me = await api.get("me");
    if (!me?.player) return { ok: false, reason: "player object missing / not signed in" };
    return playerSummary(me.player, settings, account.id);
  } catch (error) {
    return { ok: false, error: sanitizeError(error.message) };
  }
}

function playerSummary(player, settings, accountId = "main") {
  return {
    ok: true,
    resources: {
      loot: player.loot,
      energy: player.energy,
      heat: player.heat,
      jailLeft: player.jailLeft,
      nextEnergyIn: player.nextEnergyIn,
    },
    jewelryPlan: planJewelryHeistBatch(player, settings.jewelry),
    autoUpgrade: {
      enabled: accountUpgradeEnabled(settings, accountId),
      effectTypes: accountUpgradeEffectTypes(settings, accountId),
      nextAffordable: planCheapestSelectedUpgrade(player, {
        affordableOnly: true,
        lootReserve: settings.upgrade.lootReserve,
        effectTypes: accountUpgradeEffectTypes(settings, accountId),
      }),
      nextOverall: planCheapestSelectedUpgrade(player, {
        affordableOnly: false,
        lootReserve: settings.upgrade.lootReserve,
        effectTypes: accountUpgradeEffectTypes(settings, accountId),
      }),
    },
  };
}

function sanitizeError(message) {
  return String(message ?? "unknown error")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/[A-Za-z0-9+/=._-]{32,}/g, "[REDACTED]")
    .slice(0, 240);
}

function pickStatus(status) {
  return {
    exists: Boolean(status.exists),
    alive: Boolean(status.alive),
    pid: status.pid ?? null,
    startedAt: status.startedAt ?? null,
    path: status.path,
  };
}

function requireCsrf(req, token) {
  if (req.headers["x-csrf-token"] !== token) {
    const error = new Error("CSRF token mismatch.");
    error.status = 403;
    throw error;
  }
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error("Request body too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

async function tailSafeLog(fileName, maxLines) {
  try {
    const raw = await readFile(join(appDataDir(), fileName), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function buildRecentActivity(maxEvents = 6) {
  const [jewelryLines, profileLines] = await Promise.all([
    tailSafeLog("jewelry-runtime.safe.log", 100),
    tailSafeLog("profiles-runtime.safe.log", 100),
  ]);
  return [...jewelryLines, ...profileLines]
    .map(parseSafeActivityLine)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, maxEvents);
}

export function parseSafeActivityLine(line) {
  const match = String(line ?? "").match(/^\[([^\]]+)\]\s+([a-z0-9-]+)(?:\s+(.*))?$/i);
  if (!match) return null;
  const atMs = Date.parse(match[1]);
  if (!Number.isFinite(atMs)) return null;
  const message = match[2];
  const fields = {};
  for (const token of String(match[3] ?? "").split(/\s+/).filter(Boolean)) {
    const splitAt = token.indexOf("=");
    if (splitAt < 1) continue;
    const key = token.slice(0, splitAt);
    const value = token.slice(splitAt + 1);
    if (/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(key) && /^[a-zA-Z0-9_.:-]{0,96}$/.test(value)) {
      fields[key] = value;
    }
  }

  const base = {
    at: new Date(atMs).toISOString(),
    accountId: safeActivityWord(fields.accountId, "active"),
  };
  if (message === "jewelry-heist") {
    return {
      ...base,
      type: "heist",
      target: safeActivityWord(fields.target, "unknown"),
      index: safeActivityInt(fields.index),
      total: safeActivityInt(fields.total),
    };
  }
  if (message === "auto-upgrade" || message === "auto-success-upgrade") {
    return {
      ...base,
      type: "upgrade",
      track: safeActivityWord(fields.track, "unknown"),
      node: safeActivityInt(fields.node),
      cost: safeActivityInt(fields.cost),
      effect: safeActivityWord(fields.effect, message === "auto-success-upgrade" ? "suc" : "unknown"),
    };
  }
  if (message === "daily-contract-claim") {
    return { ...base, type: "daily-contract" };
  }
  if (message === "daily-streak-claim") {
    return { ...base, type: "daily-streak", day: safeActivityInt(fields.day) };
  }
  if (message === "profiles-account-error") {
    return { ...base, type: "error", category: safeActivityWord(fields.error, "request-error") };
  }
  if (message === "profiles-account-ok" && safeActivityInt(fields.gangAccepted) > 0) {
    return { ...base, type: "gang", count: safeActivityInt(fields.gangAccepted) };
  }
  if (message === "profiles-tick-live") {
    return {
      ...base,
      type: "tick",
      accounts: safeActivityInt(fields.accounts),
      enabled: safeActivityInt(fields.enabled),
      failed: safeActivityInt(fields.failed),
    };
  }
  if (message === "profiles-watch-started-live") {
    return { ...base, type: "started", intervalSeconds: safeActivityInt(fields.intervalSeconds) };
  }
  return null;
}

function safeActivityWord(value, fallback) {
  const clean = String(value ?? "");
  return /^[a-zA-Z0-9_.:-]{1,96}$/.test(clean) ? clean : fallback;
}

function safeActivityInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'");
}

function sendHtml(res, html) {
  sendText(res, 200, html, "text/html; charset=utf-8");
}

function sendText(res, status, text, type) {
  res.writeHead(status, { "content-type": type });
  res.end(text);
}

function sendJson(res, status, value) {
  const safe = JSON.parse(safeLogObject(value));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(safe, null, 2));
}

function renderIndexHtml(csrfToken) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="${escapeAttr(csrfToken)}">
  <title>Looters Control Deck</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow" data-i18n="hero_eyebrow">LOCALHOST / DPAPI / SAFE BOT</p>
        <h1 data-i18n="hero_title">Looters Control Deck</h1>
        <p class="subtitle" data-i18n="hero_subtitle">Мультипрофильный автопилот: gang auto-accept, heist по энергии/шансу, автопрокачка +SUC/+HEAT/+PAY/+REGEN и daily claim только при 0 энергии. Cookie/proxy остаются запечатаны локально.</p>
        <div class="hero-chips">
          <span id="feature-profiles" class="feature-chip"><i></i><b data-i18n="chip_profiles">Profiles</b></span>
          <span id="feature-heists" class="feature-chip"><i></i><b data-i18n="chip_heists">Safe heists</b></span>
          <span id="feature-daily" class="feature-chip"><i></i><b data-i18n="chip_daily">0-energy dailies</b></span>
          <span id="feature-suc" class="feature-chip"><i></i><b data-i18n="chip_suc">Upgrade planner</b></span>
        </div>
      </div>
      <div class="hero-actions">
        <div class="lang-switch" aria-label="Language">
          <button class="lang-option" type="button" data-lang="ru">RU</button>
          <button class="lang-option" type="button" data-lang="en">ENG</button>
        </div>
        <div class="hero-control-row">
          <button id="status-toggle" class="button ghost status-toggle" type="button" aria-expanded="false" aria-controls="status-panel">
            <span id="status-toggle-label">Show status</span>
            <span class="status-toggle-icon" aria-hidden="true"></span>
          </button>
          <button id="refresh" class="button ghost" data-i18n="refresh">Refresh</button>
        </div>
      </div>
    </section>

    <section id="status-panel" class="status-drawer" aria-hidden="true">
      <div class="status-drawer-inner">
        <h2 class="sr-only" data-i18n="status_overview">Status overview</h2>
        <div class="grid status-grid">
          <article class="card signal" id="session-card"></article>
          <article class="card signal" id="gang-card"></article>
          <article class="card signal" id="jewelry-card"></article>
          <article class="card signal" id="profiles-card"></article>
          <article class="card signal" id="upgrade-card"></article>
        </div>
      </div>
    </section>

    <section class="grid two settings-grid">
      <article class="card settings-card">
        <h2 data-i18n="gang_title">Gang auto-accept</h2>
        <label><span data-i18n="gang_interval">Standalone interval seconds</span><input id="gang-interval" type="number" min="1"></label>
        <label><span data-i18n="gang_min_earned">Min earned</span><input id="gang-min-earned" type="number" min="0"></label>
        <label><span data-i18n="gang_max">Max per tick</span><input id="gang-max" type="number" min="1" placeholder="blank = all" data-i18n-placeholder="blank_all"></label>
        <label class="check"><input id="gang-notify" type="checkbox"><span data-i18n="desktop_notify">Desktop notify</span></label>
        <label class="check run-toggle">
          <input id="gang-watch-toggle" type="checkbox">
          <span data-i18n="gang_live_toggle">Gang auto-accept running</span>
          <span id="gang-watch-state" class="inline-status warn">STOPPED</span>
        </label>
        <p class="muted" data-i18n="gang_toggle_hint">With multi-profile autopilot running, this checkbox controls gang auto-accept inside the same worker without stopping farming.</p>
      </article>

      <article class="card settings-card">
        <h2 data-i18n="heist_title">Autopilot scheduler</h2>
        <label><span data-i18n="energy_budget">Energy budget</span><input id="jewelry-energy" type="number" min="1"></label>
        <label><span data-i18n="check_interval">Check interval seconds</span><input id="jewelry-interval" type="number" min="1"></label>
        <label><span data-i18n="run_interval">Seconds between runs</span><input id="jewelry-run-interval" type="number" min="1"></label>
        <label><span data-i18n="heat_cap">Heat cap</span><input id="jewelry-heat-cap" type="number" min="0"></label>
        <label><span data-i18n="target_mode">Target mode</span>
          <select id="jewelry-target-mode">
            <option value="lowest-safe-chance" data-i18n="lowest_safe_chance">Lowest safe chance</option>
            <option value="stable-ev" data-i18n="stable_ev">Best EV / energy</option>
          </select>
        </label>
        <label><span data-i18n="min_success">Min success chance %</span><input id="jewelry-min-chance" type="number" min="0" max="100" step="0.1"></label>
        <label class="check"><input id="jewelry-full-budget" type="checkbox"><span data-i18n="wait_full_energy">Wait for full energy budget</span></label>
        <label class="check"><input id="daily-auto-claim" type="checkbox"><span data-i18n="daily_auto_claim">Auto-claim daily reward/contracts at 0 energy</span></label>
        <p class="muted" data-i18n="heist_hint">The common worker waits for the energy budget, runs the lowest eligible chance not below 24%, and applies enabled gang, daily, and upgrade modules.</p>
        <div class="scheduler-actions">
          <div class="row">
            <button class="button" data-action="start" data-target="profiles" data-i18n="start_profiles">Start selected</button>
            <button id="start-all-profiles" class="button ghost" data-i18n="start_all_profiles">Start all</button>
            <button class="button danger" data-action="stop" data-target="profiles" data-i18n="stop_profiles">Stop autopilot</button>
          </div>
          <p class="muted" data-i18n="autopilot_launch_hint">The same background worker runs checked accounts or all accounts. Settings are reread automatically.</p>
        </div>
      </article>
    </section>

    <section class="card accounts-card">
      <div class="row spread accounts-head">
        <div>
          <p class="eyebrow" data-i18n="accounts_eyebrow">ACCOUNTS</p>
          <h2 data-i18n="accounts_title">Main account + proxy profiles</h2>
          <p class="muted" data-i18n="accounts_hint">Main account always uses direct connection without proxy. Other profiles may use their own HTTP/HTTPS proxy. Auto-refresh pauses while you type.</p>
        </div>
        <div class="row account-bulk-actions">
          <button id="select-all-accounts" class="button" data-i18n="select_all_profiles">Select all profiles</button>
          <button id="refresh-accounts" class="button ghost" data-i18n="refresh_stats">Refresh stats</button>
        </div>
      </div>

      <div class="account-layout">
        <article class="account-card main-account" id="main-account-card"></article>

        <article class="account-form">
          <h3 data-i18n="add_profile_title">Add proxy profile</h3>
          <label><span data-i18n="profile_name">Profile name</span><input id="profile-name" autocomplete="off" placeholder="alt-1 / mobile / raid" data-i18n-placeholder="profile_name_placeholder"></label>
          <input id="profile-cookie" type="password" autocomplete="off" spellcheck="false" placeholder="Cookie: PHPSESSID=..." data-i18n-placeholder="profile_cookie_placeholder">
          <input id="profile-proxy" type="password" autocomplete="off" spellcheck="false" placeholder="Proxy: http://user:pass@host:port" data-i18n-placeholder="profile_proxy_placeholder">
          <div class="row">
            <button id="add-profile" class="button" data-i18n="add_profile_button">Add profile + make active</button>
          </div>
          <p class="muted" data-i18n="profile_update_hint">For updating existing profiles, paste cookie/proxy here, then click the profile action.</p>
        </article>
      </div>

      <div id="profile-list" class="profile-list account-grid"></div>
    </section>

    <section class="card">
      <div class="row spread">
        <h2 data-i18n="safe_log">Safe event log</h2>
        <button id="clear-output" class="button ghost" data-i18n="clear_panel">Clear panel</button>
      </div>
      <pre id="output"></pre>
    </section>
  </main>
  <aside id="bot-activity" class="bot-activity" aria-live="polite" aria-label="Draggable bot activity window">
    <div class="bot-activity-head">
      <span class="bot-beacon"><i></i><span data-i18n="bot_activity">BOT ACTIVITY</span></span>
      <strong id="bot-activity-state">BACKGROUND OFF</strong>
    </div>
    <div id="bot-runtime-meta" class="bot-runtime-meta">3s POLL · 10 ENERGY · 3s RUN GAP</div>
    <div id="bot-activity-feed" class="bot-activity-feed">
      <span class="activity-empty" data-i18n="activity_waiting">Waiting for worker activity…</span>
    </div>
  </aside>
  <script src="/app.js"></script>
</body>
</html>`;
}

function renderCss() {
  return `
:root {
  color-scheme: dark;
  --bg: #050505;
  --panel: rgba(14, 14, 14, .82);
  --panel-strong: rgba(24, 24, 24, .96);
  --line: rgba(255, 255, 255, .16);
  --text: #f4f4f4;
  --muted: #9a9a9a;
  --acid: #ffffff;
  --amber: #bdbdbd;
  --red: #777777;
  --green: #f4f4f4;
  --shadow: 0 24px 80px rgba(0,0,0,.48);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 18% 0%, rgba(255,255,255,.12), transparent 32%),
    radial-gradient(circle at 84% 22%, rgba(255,255,255,.06), transparent 28%),
    linear-gradient(135deg, #020202 0%, #111111 48%, #050505 100%);
  font-family: "Cascadia Code", "IBM Plex Mono", "SFMono-Regular", monospace;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(circle at center, black, transparent 82%);
}
.shell { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 34px 0 48px; }
.hero { display: flex; align-items: end; justify-content: space-between; gap: 22px; padding: 24px 0 28px; }
.hero-copy { min-width: 0; }
.hero-actions {
  display: grid;
  gap: 12px;
  justify-items: end;
  align-self: start;
  flex: 0 0 auto;
}
.hero-control-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.lang-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px;
  background: rgba(0,0,0,.28);
  box-shadow: 0 12px 30px rgba(0,0,0,.24);
}
.lang-option {
  border: 0;
  border-radius: 999px;
  padding: 8px 11px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 12px;
  letter-spacing: .08em;
  cursor: pointer;
}
.lang-option.active {
  color: #050505;
  background: #fff;
}
.status-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.status-toggle[aria-expanded="true"] {
  color: #fff;
  border-color: rgba(255,255,255,.58);
  background: rgba(255,255,255,.1);
  box-shadow: 0 0 24px rgba(255,255,255,.1);
}
.status-toggle-icon {
  width: 8px;
  height: 8px;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: translateY(-2px) rotate(45deg);
  transition: transform .24s ease;
}
.status-toggle[aria-expanded="true"] .status-toggle-icon {
  transform: translateY(2px) rotate(225deg);
}
.eyebrow { color: var(--acid); letter-spacing: .18em; font-size: 12px; margin: 0 0 12px; }
h1 { font-size: clamp(40px, 8vw, 88px); line-height: .88; margin: 0; letter-spacing: -0.08em; }
h2 { margin: 0 0 18px; font-size: 18px; letter-spacing: -.03em; }
.subtitle { max-width: 690px; color: var(--muted); font-size: 16px; line-height: 1.6; }
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.hero-chips .feature-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px;
  padding: 7px 10px;
  color: #ddd;
  background: rgba(255,255,255,.04);
  font-size: 12px;
  transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
}
.feature-chip b { font: inherit; }
.feature-chip i,
.bot-beacon i {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #555;
  box-shadow: 0 0 0 3px rgba(255,255,255,.03);
}
.feature-chip.is-live {
  color: #fff;
  border-color: rgba(255,255,255,.7);
  background: rgba(255,255,255,.1);
  box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset, 0 0 22px rgba(255,255,255,.16);
}
.feature-chip.is-live i,
.bot-activity.is-live .bot-beacon i {
  background: #fff;
  box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 0 18px rgba(255,255,255,.9);
  animation: signalPulse 1.8s ease-in-out infinite;
}
.bot-activity {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 80;
  width: min(330px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 18px;
  background: rgba(7,7,7,.92);
  box-shadow: 0 24px 70px rgba(0,0,0,.58), 0 0 0 1px rgba(255,255,255,.03) inset;
  backdrop-filter: blur(20px);
  transition: border-color .25s ease, box-shadow .25s ease;
}
.bot-activity.is-live {
  border-color: rgba(255,255,255,.48);
  box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 0 38px rgba(255,255,255,.12), 0 18px 50px rgba(0,0,0,.34);
}
.bot-activity.is-dragging {
  border-color: rgba(255,255,255,.72);
  box-shadow: 0 28px 80px rgba(0,0,0,.68), 0 0 0 1px rgba(255,255,255,.12) inset;
  transition: none;
}
.bot-activity-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px 8px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.bot-activity.is-dragging .bot-activity-head { cursor: grabbing; }
.bot-activity-head strong {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: .1em;
}
.bot-activity.is-live .bot-activity-head strong { color: #fff; text-shadow: 0 0 14px rgba(255,255,255,.6); }
.bot-beacon { display: inline-flex; align-items: center; gap: 8px; color: #ddd; font-size: 11px; letter-spacing: .13em; }
.bot-runtime-meta {
  padding: 0 14px 10px;
  color: #767676;
  font-size: 10px;
  letter-spacing: .08em;
}
.bot-activity-feed {
  max-height: calc(100vh - 116px);
  overflow-y: auto;
  border-top: 1px solid rgba(255,255,255,.08);
  overscroll-behavior: contain;
}
.activity-event {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid rgba(255,255,255,.05);
  font-size: 11px;
}
.activity-event:first-child { border-top: 0; }
.activity-time { color: #6f6f6f; font-variant-numeric: tabular-nums; }
.activity-text { color: #d5d5d5; overflow-wrap: anywhere; }
.activity-event.is-error .activity-text { color: #aaa; }
.activity-empty { display: block; padding: 11px 14px; color: #707070; font-size: 11px; }
@keyframes signalPulse {
  0%, 100% { opacity: .72; transform: scale(.92); }
  50% { opacity: 1; transform: scale(1.08); }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.grid { display: grid; gap: 16px; margin-bottom: 16px; }
.status-drawer {
  display: grid;
  grid-template-rows: 0fr;
  margin-bottom: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-8px);
  transition: grid-template-rows .3s ease, margin-bottom .3s ease, opacity .22s ease, transform .3s ease;
}
.status-drawer.is-open {
  grid-template-rows: 1fr;
  margin-bottom: 16px;
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.status-drawer-inner { min-height: 0; overflow: hidden; }
.status-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: start;
  gap: 14px;
  margin-bottom: 0;
}
.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.settings-grid { align-items: start; }
.card {
  border: 1px solid var(--line);
  background: linear-gradient(180deg, var(--panel-strong), var(--panel));
  box-shadow: var(--shadow);
  border-radius: 26px;
  padding: 20px;
  backdrop-filter: blur(18px);
}
.scheduler-actions {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,.12);
}
.scheduler-actions .row { margin-top: 0; }
.scheduler-actions .muted { margin: 10px 0 0; font-size: 12px; }
.signal {
  min-width: 0;
  min-height: 0;
  aspect-ratio: 1;
  position: relative;
  overflow: hidden;
  padding: clamp(14px, 1.5vw, 18px);
}
.signal::after { content:""; position:absolute; inset:auto -20% -55% 35%; height:110px; background: radial-gradient(circle, rgba(255,255,255,.12), transparent 65%); }
.signal.is-live {
  border-color: rgba(255,255,255,.48);
  box-shadow: var(--shadow), 0 0 32px rgba(255,255,255,.1);
}
.kicker { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .14em; }
.big { font-size: 34px; margin: 8px 0; letter-spacing: -.06em; }
.signal .kicker { font-size: 10px; }
.signal .big {
  margin: 7px 0 9px;
  font-size: clamp(23px, 2.2vw, 30px);
  line-height: 1.02;
  overflow-wrap: anywhere;
}
.signal .muted {
  margin: 0;
  font-size: 11px;
  line-height: 1.38;
  overflow-wrap: anywhere;
}
.ok { color: var(--green); }
.warn { color: var(--amber); }
.bad { color: var(--red); }
.muted { color: var(--muted); line-height: 1.5; }
label { display: grid; gap: 8px; color: var(--muted); margin: 12px 0; font-size: 13px; }
input,
select {
  width: 100%;
  border: 1px solid rgba(238,248,223,.14);
  background: rgba(0,0,0,.28);
  color: var(--text);
  border-radius: 14px;
  padding: 13px 14px;
  outline: none;
  font: inherit;
}
input:focus,
select:focus { border-color: var(--acid); box-shadow: 0 0 0 4px rgba(255,255,255,.08); }
.check { display: flex; align-items: center; gap: 10px; }
.check input { width: auto; accent-color: var(--acid); }
.check:has(input:checked) {
  color: #fff;
  text-shadow: 0 0 14px rgba(255,255,255,.28);
}
.check:has(input:checked):not(.run-toggle) {
  filter: drop-shadow(0 0 8px rgba(255,255,255,.12));
}
.run-toggle {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(255,255,255,.16);
  border-radius: 18px;
  padding: 12px;
  background: rgba(255,255,255,.04);
}
.run-toggle input {
  width: 18px;
  height: 18px;
}
.inline-status {
  margin-left: auto;
  border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 11px;
  letter-spacing: .08em;
}
.accounts-card { margin-bottom: 16px; }
.accounts-head { align-items: start; margin-top: 0; }
.account-layout {
  display: grid;
  grid-template-columns: minmax(320px, .95fr) minmax(320px, 1.05fr);
  gap: 16px;
  margin-top: 16px;
}
.account-form, .account-card {
  border: 1px solid rgba(238,248,223,.12);
  background: rgba(0,0,0,.18);
  border-radius: 20px;
  padding: 16px;
}
.account-form h3 { margin: 0 0 12px; font-size: 15px; }
.main-account {
  border-color: rgba(255,255,255,.34);
  background:
    radial-gradient(circle at 16% 0%, rgba(255,255,255,.1), transparent 36%),
    rgba(0,0,0,.2);
}
.account-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  align-items: start;
  gap: 12px;
  margin-top: 16px;
}
.account-item.selected-account {
  border-color: rgba(255,255,255,.62);
  box-shadow: 0 0 0 1px rgba(255,255,255,.22) inset, 0 0 42px rgba(255,255,255,.08);
}
.account-item.selected-account::before {
  content: "";
  display: block;
  height: 3px;
  margin: -12px -12px 2px;
  border-radius: 16px 16px 0 0;
  background: linear-gradient(90deg, #fff, rgba(255,255,255,.14));
}
.account-name { font-size: 18px; letter-spacing: -.04em; overflow-wrap: anywhere; }
.account-meta {
  margin-top: 4px;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
  gap: 8px;
}
.stat-grid div {
  min-width: 0;
  border: 1px solid rgba(238,248,223,.08);
  background: rgba(0,0,0,.2);
  border-radius: 14px;
  padding: 10px;
}
.stat-grid span { display: block; color: var(--muted); font-size: 11px; }
.stat-grid strong { display: block; margin-top: 3px; font-size: 17px; overflow-wrap: anywhere; }
.small-line { font-size: 12px; overflow-wrap: anywhere; word-break: break-word; }
.upgrade-selector {
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 15px;
  background: rgba(255,255,255,.025);
}
.upgrade-selector-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  color: #d8d8d8;
  font-size: 11px;
  letter-spacing: .02em;
}
.upgrade-selector-head small {
  color: #777;
  font-size: 10px;
  text-align: right;
}
.upgrade-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.upgrade-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 8px 6px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 11px;
  color: #818181;
  background: rgba(0,0,0,.24);
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  transition: color .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease;
}
.upgrade-option input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #fff;
}
.upgrade-option:has(input:checked) {
  color: #fff;
  border-color: rgba(255,255,255,.58);
  background: rgba(255,255,255,.09);
  box-shadow: 0 0 18px rgba(255,255,255,.12);
}
.upgrade-option input:disabled { cursor: wait; opacity: .62; }
.empty-state {
  border: 1px dashed rgba(238,248,223,.16);
  border-radius: 18px;
  padding: 16px;
}
.secret-inline { margin-top: 12px; }
.profile-list { display: grid; gap: 10px; margin-top: 16px; }
.profile-item {
  min-width: 0;
  overflow: hidden;
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(238,248,223,.1);
  border-radius: 16px;
  background: rgba(0,0,0,.18);
}
.profile-title { display: flex; align-items: start; justify-content: space-between; gap: 12px; min-width: 0; }
.profile-title > div { min-width: 0; }
.pill {
  flex: 0 0 auto;
  border: 1px solid rgba(255,255,255,.28);
  border-radius: 999px;
  color: var(--acid);
  padding: 4px 8px;
  font-size: 11px;
  letter-spacing: .08em;
}
.pill.dim { color: var(--muted); border-color: rgba(238,248,223,.12); }
.account-run-select {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  cursor: pointer;
  user-select: none;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: .04em;
}
.account-run-select input {
  width: 17px;
  height: 17px;
  margin: 0;
  accent-color: #fff;
}
.account-run-select:has(input:checked) {
  color: #fff;
  text-shadow: 0 0 14px rgba(255,255,255,.35);
}
.account-bulk-actions { margin-top: 0; justify-content: flex-end; }
.account-bulk-actions .button:disabled,
.account-run-select input:disabled { cursor: wait; opacity: .62; }
.button.mini { padding: 8px 11px; font-size: 12px; white-space: nowrap; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.profile-item .row { align-items: flex-start; gap: 8px; }
.spread { justify-content: space-between; }
.button {
  border: 1px solid rgba(255,255,255,.34);
  background: var(--acid);
  color: #050505;
  border-radius: 999px;
  padding: 11px 16px;
  font: inherit;
  cursor: pointer;
  transition: transform .15s ease, border-color .15s ease, background .15s ease;
}
.button:hover { transform: translateY(-1px); }
.button.ghost { background: rgba(255,255,255,.06); color: var(--text); }
.button.danger { background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.24); color: #d0d0d0; }
pre {
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  color: #d9ebc7;
  background: rgba(0,0,0,.28);
  border: 1px solid rgba(238,248,223,.1);
  border-radius: 18px;
  padding: 16px;
}
@media (max-width: 899px) {
  .bot-activity {
    top: 12px;
    right: 12px;
    bottom: auto;
    left: auto;
    width: min(330px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
  }
  .bot-activity-feed { max-height: calc(100vh - 104px); }
}
@media (max-width: 860px) {
  .status-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .two, .account-layout { grid-template-columns: 1fr; }
  .hero { align-items: start; flex-direction: column; }
  .hero-actions { width: 100%; display: flex; justify-content: space-between; align-items: center; }
}
@media (max-width: 600px) {
  .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 460px) {
  .hero-actions { align-items: stretch; flex-direction: column; }
  .hero-control-row { width: 100%; }
  .hero-control-row .button { flex: 1 1 0; }
  .upgrade-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 390px) {
  .status-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .status-drawer,
  .status-toggle-icon { transition: none; }
}`;
}

function renderClientJs() {
  return `
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
const $ = (id) => document.getElementById(id);
let settingsDirty = false;
let settingsSaveTimer = null;
let lastDashboard = null;
let dashboardRequestSequence = 0;
let latestAppliedDashboardRequest = 0;
const pendingAutomationByAccount = new Map();
const pendingUpgradeByAccount = new Map();
const UPGRADE_EFFECT_TYPES = ['suc', 'heat', 'pay', 'regen'];
let selectAllAccountsSaving = false;
const LANG_STORAGE_KEY = 'looters-ui-language';
const BOT_ACTIVITY_POSITION_KEY = 'looters-bot-activity-position';
const BOT_ACTIVITY_EDGE = 8;
let botActivityDragState = null;
let statusPanelExpanded = false;
let currentLang = normalizeLang(localStorage.getItem(LANG_STORAGE_KEY) || 'ru');

const I18N = {
  en: {
    hero_eyebrow: 'LOCALHOST / DPAPI / SAFE BOT',
    hero_title: 'Looters Control Deck',
    hero_subtitle: 'Multi-profile autopilot: gang auto-accept, energy/chance heists, lowest-price +SUC / +HEAT / +PAY / +REGEN upgrades and daily claim only at 0 energy. Cookies and proxies stay sealed locally.',
    chip_profiles: 'Profiles',
    chip_heists: 'Safe heists',
    chip_daily: '0-energy dailies',
    chip_suc: 'Upgrade planner',
    show_status: 'Show status',
    hide_status: 'Hide status',
    status_overview: 'Status overview',
    bot_activity: 'BOT ACTIVITY',
    background_online: 'BACKGROUND ONLINE',
    background_legacy: 'LEGACY WATCHER ONLINE',
    background_off: 'BACKGROUND OFF',
    activity_waiting: 'Waiting for worker activity…',
    activity_heist: '{account}: heist {target} · {progress}',
    activity_upgrade: '{account}: +{effect} upgrade {track}:{node} · cost {cost}',
    activity_daily_contract: '{account}: daily contract claimed',
    activity_daily_streak: '{account}: daily streak day {day} claimed',
    activity_gang: '{account}: accepted {count} gang request(s)',
    activity_tick: 'All profiles checked · {enabled}/{accounts} enabled · {failed} failed',
    activity_started: 'Background worker started · poll {interval}s',
    activity_error: '{account}: worker error · {category}',
    refresh: 'Refresh',
    gang_title: 'Gang auto-accept',
    gang_interval: 'Gang eligibility interval seconds',
    gang_min_earned: 'Min earned',
    gang_max: 'Max per tick',
    blank_all: 'blank = all',
    desktop_notify: 'Desktop notify',
    gang_live_toggle: 'Enable gang auto-accept in autopilot',
    gang_toggle_hint: 'This setting arms gang auto-accept inside the same multi-profile worker. It never starts a separate single-account process.',
    heist_title: 'Autopilot scheduler',
    energy_budget: 'Energy budget',
    check_interval: 'Check interval seconds',
    run_interval: 'Seconds between runs',
    heat_cap: 'Heat cap',
    target_mode: 'Target mode',
    lowest_safe_chance: 'Lowest safe chance',
    stable_ev: 'Best EV / energy',
    min_success: 'Min success chance %',
    wait_full_energy: 'Wait for full energy budget',
    daily_auto_claim: 'Auto-claim daily reward/contracts at 0 energy',
    heist_hint: 'The common worker waits for the energy budget, runs the lowest eligible chance not below 24%, and applies enabled gang, daily, and upgrade modules.',
    autopilot_launch_hint: 'Start checked accounts or all accounts in the same background worker. Selections and settings are reread automatically.',
    accounts_eyebrow: 'ACCOUNTS',
    accounts_title: 'Main account + proxy profiles',
    accounts_hint: 'Check any profiles that should run together in the multi-profile autopilot. Main stays direct; other profiles may use their own HTTP/HTTPS proxy.',
    select_all_profiles: 'Select all profiles',
    all_profiles_selected: 'All profiles selected',
    refresh_stats: 'Refresh stats',
    add_profile_title: 'Add proxy profile',
    profile_name: 'Profile name',
    profile_name_placeholder: 'alt-1 / mobile / raid',
    profile_cookie_placeholder: 'Cookie: PHPSESSID=...',
    profile_proxy_placeholder: 'Proxy: http://user:pass@host:port',
    add_profile_button: 'Add profile + make active',
    profile_update_hint: 'For updating existing profiles, paste cookie/proxy here, then click the profile action.',
    start_profiles: 'Start selected',
    start_all_profiles: 'Start all',
    stop_profiles: 'Stop autopilot',
    safe_log: 'Safe event log',
    clear_panel: 'Clear panel',
    active_session: 'ACTIVE: {name}',
    session: 'SESSION',
    signed_in: 'SIGNED IN',
    check_cookie: 'CHECK COOKIE',
    not_signed_in: 'not signed in',
    gang_watcher: 'GANG ENGINE',
    jewelry_watcher: 'HEIST ENGINE',
    all_profiles: 'ALL PROFILES',
    live: 'LIVE #{pid}',
    via_autopilot: 'VIA AUTOPILOT',
    disabled_in_autopilot: 'OFF IN AUTOPILOT',
    armed_for_autopilot: 'ARMED FOR AUTOPILOT',
    stopped: 'STOPPED',
    started: 'started',
    farm_group: 'FARM GROUP',
    selected_profiles: '{selected}/{total} SELECTED',
    backend_profiles_ok: '{ready}/{selected} backend profiles readable',
    per_profile_runtime: 'per-profile state is shown in account cards below',
    auto_upgrade: 'AUTO UPGRADE',
    off: 'OFF',
    armed: 'ARMED',
    checkbox_disabled: 'checkbox disabled',
    next: 'next',
    no_known_suc: 'no known selected upgrade nodes',
    waiting_for_loot: 'waiting for loot',
    no_eligible_suc: 'no eligible selected upgrade',
    main_account: 'Main account',
    no_profiles: 'No proxy profiles yet. Add one on the right; main stays direct/no proxy.',
    direct_no_proxy: 'DIRECT / NO PROXY',
    no_proxy_set: 'NO PROXY SET',
    cookie: 'cookie',
    saved: 'saved',
    missing: 'missing',
    proxy: 'proxy',
    main: 'main',
    profile: 'profile',
    active: 'ACTIVE',
    standby: 'STANDBY',
    activating: 'SAVING',
    active_account_toggle: 'Include this profile in the simultaneous run',
    run_together: 'Run together',
    loot: 'Loot',
    energy: 'Energy',
    heat: 'Heat',
    next_stat: 'Next',
    not_checked: 'not checked',
    plan_unknown: 'plan=unknown',
    next_suc_none: 'next selected upgrade none/locked',
    auto_upgrade_account: 'Auto-upgrade by lowest price',
    selected_upgrade_types: 'Selected: {types}',
    use_main: 'Use main',
    update_main_cookie: 'Update main cookie',
    clear_main_cookie: 'Clear main cookie',
    use: 'Use',
    update_cookie: 'Update cookie',
    update_proxy: 'Update proxy',
    clear_proxy: 'Clear proxy',
    delete: 'Delete',
    main_cookie_placeholder: 'Main Cookie: PHPSESSID=...',
    paste_main_cookie: 'Paste the main Cookie header into the Main Cookie input first.',
    clear_main_confirm: 'Clear encrypted Cookie for Main account?',
    paste_profile_cookie: 'Paste the new Cookie header into the profile cookie input first.',
    paste_profile_proxy: 'Paste proxy URL into the profile proxy input first.',
    delete_profile_confirm: 'Delete this encrypted profile cookie?'
  },
  ru: {
    hero_eyebrow: 'LOCALHOST / DPAPI / SAFE BOT',
    hero_title: 'Looters Control Deck',
    hero_subtitle: 'Мультипрофильный автопилот: заявки в gang, heist по энергии и шансу, автопрокачка +SUC / +HEAT / +PAY / +REGEN по минимальной цене и daily claim только при 0 энергии. Cookie и proxy остаются запечатаны локально.',
    chip_profiles: 'Профили',
    chip_heists: 'Безопасные раны',
    chip_daily: 'Дейлики при 0 энергии',
    chip_suc: 'Автопрокачка',
    show_status: 'Показать статус',
    hide_status: 'Скрыть статус',
    status_overview: 'Сводка статуса',
    bot_activity: 'ДЕЙСТВИЯ БОТА',
    background_online: 'ФОНОВЫЙ РЕЖИМ АКТИВЕН',
    background_legacy: 'LEGACY WATCHER АКТИВЕН',
    background_off: 'ФОНОВЫЙ РЕЖИМ ВЫКЛЮЧЕН',
    activity_waiting: 'Ожидаю действия worker…',
    activity_heist: '{account}: ран {target} · {progress}',
    activity_upgrade: '{account}: +{effect} апгрейд {track}:{node} · цена {cost}',
    activity_daily_contract: '{account}: daily контракт заклеймлен',
    activity_daily_streak: '{account}: daily streak, день {day}',
    activity_gang: '{account}: принято gang-заявок: {count}',
    activity_tick: 'Все профили проверены · включено {enabled}/{accounts} · ошибок {failed}',
    activity_started: 'Фоновый worker запущен · опрос {interval} сек',
    activity_error: '{account}: ошибка worker · {category}',
    refresh: 'Обновить',
    gang_title: 'Автопринятие в gang',
    gang_interval: 'Интервал gang-проверки, сек',
    gang_min_earned: 'Мин. earned',
    gang_max: 'Макс. за тик',
    blank_all: 'пусто = все',
    desktop_notify: 'Уведомления',
    gang_live_toggle: 'Включить Gang auto-accept в автопилоте',
    gang_toggle_hint: 'Галочка включает gang auto-accept внутри общего мультипрофильного worker и никогда не запускает отдельный single-account процесс.',
    heist_title: 'Планировщик автопилота',
    energy_budget: 'Бюджет энергии',
    check_interval: 'Интервал проверки, сек',
    run_interval: 'Интервал между ранами, сек',
    heat_cap: 'Лимит heat',
    target_mode: 'Режим цели',
    lowest_safe_chance: 'Минимальный безопасный шанс',
    stable_ev: 'Лучший EV / энергия',
    min_success: 'Мин. шанс успеха %',
    wait_full_energy: 'Ждать полный бюджет энергии',
    daily_auto_claim: 'Автоклейм daily reward/contracts при 0 энергии',
    heist_hint: 'Общий worker ждёт бюджет энергии, запускает раны с минимальным шансом не ниже 24% и применяет включённые модули gang, daily и upgrade.',
    autopilot_launch_hint: 'Запускает отмеченные либо все аккаунты в одном фоновом worker. Выбор и настройки перечитываются автоматически.',
    accounts_eyebrow: 'ПРОФИЛИ',
    accounts_title: 'Main аккаунт + proxy профили',
    accounts_hint: 'Отметь галочками профили для одновременного запуска в мультипрофильном автопилоте. Main работает напрямую, остальные профили могут использовать свой HTTP/HTTPS proxy.',
    select_all_profiles: 'Выбрать все профили',
    all_profiles_selected: 'Все профили выбраны',
    refresh_stats: 'Обновить статистику',
    add_profile_title: 'Добавить proxy профиль',
    profile_name: 'Имя профиля',
    profile_name_placeholder: 'alt-1 / mobile / raid',
    profile_cookie_placeholder: 'Cookie: PHPSESSID=...',
    profile_proxy_placeholder: 'Proxy: http://user:pass@host:port',
    add_profile_button: 'Добавить профиль + сделать активным',
    profile_update_hint: 'Чтобы обновить существующий профиль, вставь cookie/proxy сюда и нажми действие на карточке профиля.',
    start_profiles: 'Запустить выбранные',
    start_all_profiles: 'Запустить все',
    stop_profiles: 'Остановить автопилот',
    safe_log: 'Safe event log',
    clear_panel: 'Очистить панель',
    active_session: 'АКТИВЕН: {name}',
    session: 'СЕССИЯ',
    signed_in: 'ВХОД ОК',
    check_cookie: 'ПРОВЕРЬ COOKIE',
    not_signed_in: 'нет входа',
    gang_watcher: 'GANG ENGINE',
    jewelry_watcher: 'HEIST ENGINE',
    all_profiles: 'ВСЕ ПРОФИЛИ',
    live: 'LIVE #{pid}',
    via_autopilot: 'ЧЕРЕЗ AUTOPILOT',
    disabled_in_autopilot: 'ВЫКЛЮЧЕН В AUTOPILOT',
    armed_for_autopilot: 'ГОТОВ К AUTOPILOT',
    stopped: 'STOPPED',
    started: 'старт',
    farm_group: 'ГРУППА ФАРМА',
    selected_profiles: 'ВЫБРАНО {selected}/{total}',
    backend_profiles_ok: 'backend доступен у {ready}/{selected} профилей',
    per_profile_runtime: 'состояние каждого профиля показано в карточках ниже',
    auto_upgrade: 'AUTO UPGRADE',
    off: 'OFF',
    armed: 'ARMED',
    checkbox_disabled: 'галочка выключена',
    next: 'следующий',
    no_known_suc: 'нет известных нод выбранных типов',
    waiting_for_loot: 'ждёт loot',
    no_eligible_suc: 'нет доступной прокачки выбранных типов',
    main_account: 'Main account',
    no_profiles: 'Proxy профилей пока нет. Добавь профиль справа; main остаётся direct/no proxy.',
    direct_no_proxy: 'DIRECT / NO PROXY',
    no_proxy_set: 'NO PROXY SET',
    cookie: 'cookie',
    saved: 'saved',
    missing: 'missing',
    proxy: 'proxy',
    main: 'main',
    profile: 'profile',
    active: 'АКТИВЕН',
    standby: 'STANDBY',
    activating: 'СОХРАНЯЮ',
    active_account_toggle: 'Добавить профиль в одновременный запуск',
    run_together: 'Запускать вместе',
    loot: 'Loot',
    energy: 'Energy',
    heat: 'Heat',
    next_stat: 'Next',
    not_checked: 'не проверено',
    plan_unknown: 'plan=unknown',
    next_suc_none: 'нет доступной прокачки выбранных типов',
    auto_upgrade_account: 'Автопрокачка по минимальной цене',
    selected_upgrade_types: 'Выбрано: {types}',
    use_main: 'Выбрать main',
    update_main_cookie: 'Обновить main cookie',
    clear_main_cookie: 'Очистить main cookie',
    use: 'Выбрать',
    update_cookie: 'Обновить cookie',
    update_proxy: 'Обновить proxy',
    clear_proxy: 'Очистить proxy',
    delete: 'Удалить',
    main_cookie_placeholder: 'Main Cookie: PHPSESSID=...',
    paste_main_cookie: 'Сначала вставь Main Cookie header в поле Main Cookie.',
    clear_main_confirm: 'Очистить зашифрованный Cookie для Main account?',
    paste_profile_cookie: 'Сначала вставь новый Cookie header в поле profile cookie.',
    paste_profile_proxy: 'Сначала вставь proxy URL в поле profile proxy.',
    delete_profile_confirm: 'Удалить этот зашифрованный профиль?'
  }
};

function normalizeLang(value) {
  return value === 'en' ? 'en' : 'ru';
}

function t(key, vars = {}) {
  const text = I18N[currentLang]?.[key] ?? I18N.en[key] ?? key;
  return String(text).replace(/\\{([a-zA-Z0-9_]+)\\}/g, (_, name) => vars[name] ?? '');
}

function applyLanguage(lang) {
  currentLang = normalizeLang(lang);
  localStorage.setItem(LANG_STORAGE_KEY, currentLang);
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-lang]').forEach((button) => {
    const active = button.dataset.lang === currentLang;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  updateStatusPanelToggle();
}

function updateStatusPanelToggle() {
  const button = $('status-toggle');
  const label = $('status-toggle-label');
  const panel = $('status-panel');
  if (!button || !label || !panel) return;
  button.setAttribute('aria-expanded', statusPanelExpanded ? 'true' : 'false');
  label.textContent = t(statusPanelExpanded ? 'hide_status' : 'show_status');
  panel.classList.toggle('is-open', statusPanelExpanded);
  panel.setAttribute('aria-hidden', statusPanelExpanded ? 'false' : 'true');
}

function setStatusPanelExpanded(expanded) {
  statusPanelExpanded = Boolean(expanded);
  updateStatusPanelToggle();
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function placeBotActivity(x, y, { persist = false } = {}) {
  const panel = $('bot-activity');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const maxX = Math.max(BOT_ACTIVITY_EDGE, window.innerWidth - rect.width - BOT_ACTIVITY_EDGE);
  const maxY = Math.max(BOT_ACTIVITY_EDGE, window.innerHeight - rect.height - BOT_ACTIVITY_EDGE);
  const nextX = clampNumber(Number(x) || BOT_ACTIVITY_EDGE, BOT_ACTIVITY_EDGE, maxX);
  const nextY = clampNumber(Number(y) || BOT_ACTIVITY_EDGE, BOT_ACTIVITY_EDGE, maxY);
  panel.style.left = \`\${Math.round(nextX)}px\`;
  panel.style.top = \`\${Math.round(nextY)}px\`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  if (persist) {
    try {
      localStorage.setItem(BOT_ACTIVITY_POSITION_KEY, JSON.stringify({ x: nextX, y: nextY }));
    } catch {
      // Window position is non-secret and may safely remain session-only.
    }
  }
}

function clampBotActivityToViewport({ persist = false } = {}) {
  const panel = $('bot-activity');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  placeBotActivity(rect.left, rect.top, { persist });
}

function restoreBotActivityPosition() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(BOT_ACTIVITY_POSITION_KEY) || 'null');
  } catch {
    saved = null;
  }
  requestAnimationFrame(() => {
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
      placeBotActivity(saved.x, saved.y);
    } else {
      clampBotActivityToViewport();
    }
  });
}

function initBotActivityDrag() {
  const panel = $('bot-activity');
  const handle = panel?.querySelector('.bot-activity-head');
  if (!panel || !handle) return;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button, a, input, select, textarea')) return;
    const rect = panel.getBoundingClientRect();
    botActivityDragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add('is-dragging');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', (event) => {
    if (!botActivityDragState || event.pointerId !== botActivityDragState.pointerId) return;
    placeBotActivity(
      event.clientX - botActivityDragState.offsetX,
      event.clientY - botActivityDragState.offsetY,
    );
  });

  const finishDrag = (event) => {
    if (!botActivityDragState || event.pointerId !== botActivityDragState.pointerId) return;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    botActivityDragState = null;
    panel.classList.remove('is-dragging');
    clampBotActivityToViewport({ persist: true });
  };

  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  window.addEventListener('resize', () => {
    requestAnimationFrame(() => clampBotActivityToViewport({ persist: true }));
  });
}

function log(value) {
  const out = $('output');
  out.textContent = JSON.stringify(value, null, 2) + "\\n\\n" + out.textContent;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      ...(options.headers || {})
    }
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error || 'Request failed');
  return json;
}

async function refresh() {
  if (isEditingForm()) return;
  await fetchDashboard(false);
}

async function forceRefresh() {
  await fetchDashboard(true);
}

async function fetchDashboard(force) {
  const requestId = ++dashboardRequestSequence;
  const data = await api('/api/dashboard', { method: 'GET', headers: {} });
  if (requestId < latestAppliedDashboardRequest) return;
  latestAppliedDashboardRequest = requestId;
  reconcilePendingAccountSelections(data.accounts || []);
  renderDashboard(data, { force });
}

function reconcilePendingAccountSelections(accounts) {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  pendingAutomationByAccount.forEach((desired, accountId) => {
    const account = byId.get(accountId);
    if (account && Boolean(account.automationEnabled) === Boolean(desired)) {
      pendingAutomationByAccount.delete(accountId);
    }
  });
  pendingUpgradeByAccount.forEach((desired, key) => {
    const separator = key.lastIndexOf(':');
    const accountId = key.slice(0, separator);
    const effectType = key.slice(separator + 1);
    const account = byId.get(accountId);
    if (account && Boolean(account.upgradeSelection?.[effectType]) === Boolean(desired)) {
      pendingUpgradeByAccount.delete(key);
    }
  });
}

function renderDashboard(data, options = {}) {
  lastDashboard = data;
  const accountDrafts = captureAccountDraftInputs();
  const accounts = data.accounts || [];
  const enabledAccounts = accounts.filter((account) => account.automationEnabled);
  const profilesLive = Boolean(data.watchers?.profiles?.alive);
  const gameState = data.gameState || {};
  const resources = gameState.resources || {};
  const activeAccount = accounts.find((account) => account.active);
  if (profilesLive) {
    const readyAccounts = enabledAccounts.filter((account) => account.stats?.ok);
    $('session-card').innerHTML = cardHtml(
      t('farm_group'),
      t('selected_profiles', { selected: enabledAccounts.length, total: accounts.length }),
      enabledAccounts.length > 0 ? 'ok' : 'warn',
      t('backend_profiles_ok', { ready: readyAccounts.length, selected: enabledAccounts.length }),
    );
  } else {
    $('session-card').innerHTML = cardHtml(activeAccount ? t('active_session', { name: activeAccount.name }) : t('session'), gameState.ok ? t('signed_in') : t('check_cookie'), gameState.ok ? 'ok' : 'bad',
      gameState.ok
        ? \`energy=\${resources.energy} heat=\${resources.heat} loot=\${resources.loot} nextEnergyIn=\${resources.nextEnergyIn}\`
        : (gameState.error || gameState.reason || t('not_signed_in')));
  }

  $('gang-card').innerHTML = effectiveWatcherHtml(
    t('gang_watcher'),
    data.watchers.gang,
    data.watchers.profiles,
    data.settings?.gang?.enabled !== false,
  );
  $('jewelry-card').innerHTML = effectiveWatcherHtml(t('jewelry_watcher'), data.watchers.jewelry, data.watchers.profiles, true, gameState.jewelryPlan);
  $('profiles-card').innerHTML = watcherHtml(t('all_profiles'), data.watchers.profiles);
  $('upgrade-card').innerHTML = profilesLive
    ? groupUpgradeHtml(enabledAccounts, data.watchers.profiles)
    : upgradeHtml(gameState.autoUpgrade || {});
  renderGangWatchToggle(data.watchers.gang, data.watchers.profiles, data.settings);
  renderHeaderActivity(data);

  if (!settingsDirty && (options.force || !isEditingSettings())) {
    const s = data.settings;
    $('gang-interval').value = s.gang.intervalSeconds;
    $('gang-min-earned').value = s.gang.minEarned;
    $('gang-max').value = s.gang.max ?? '';
    $('gang-notify').checked = Boolean(s.gang.notify);
    $('jewelry-energy').value = s.jewelry.energyBudget;
    $('jewelry-interval').value = s.jewelry.intervalSeconds;
    $('jewelry-run-interval').value = s.jewelry.runIntervalSeconds ?? 3;
    $('jewelry-heat-cap').value = s.jewelry.heatCap;
    $('jewelry-target-mode').value = s.jewelry.targetMode === 'stable-ev' ? 'stable-ev' : 'lowest-safe-chance';
    $('jewelry-min-chance').value = s.jewelry.minChance ?? 24;
    $('jewelry-full-budget').checked = Boolean(s.jewelry.requireFullBudget);
    $('daily-auto-claim').checked = Boolean(s.daily?.enabled ?? true);
  }
  if (options.force || !isEditingAccountForms()) {
    renderAccounts(data.accounts || []);
    restoreAccountDraftInputs(accountDrafts);
  }
}

function isEditingForm() {
  return isEditingSettings() || isEditingAccountForms();
}

function isEditingSettings() {
  const active = document.activeElement;
  return Boolean(active && active.closest && active.closest('#settings-root, .settings-card'));
}

function isEditingAccountForms() {
  const active = document.activeElement;
  if (active && active.matches && active.matches('input, select, textarea')) return true;
  return ['profile-name', 'profile-cookie', 'profile-proxy', 'main-cookie-input']
    .some((id) => {
      const input = $(id);
      return input && String(input.value || '').length > 0;
    });
}

function captureAccountDraftInputs() {
  const draft = {};
  ['profile-name', 'profile-cookie', 'profile-proxy', 'main-cookie-input'].forEach((id) => {
    const input = $(id);
    if (input && String(input.value || '').length > 0) draft[id] = input.value;
  });
  return draft;
}

function restoreAccountDraftInputs(draft) {
  Object.entries(draft).forEach(([id, value]) => {
    const input = $(id);
    if (input && !input.value) input.value = value;
  });
}

function cardHtml(label, main, tone, sub) {
  return \`<div class="kicker">\${escapeHtml(label)}</div><div class="big \${tone}">\${escapeHtml(main)}</div><p class="muted">\${escapeHtml(sub || '')}</p>\`;
}

function watcherHtml(label, watcher, plan) {
  const alive = watcher && watcher.alive;
  const planText = plan
    ? \` | plan=\${plan.type} \${plan.reason || ''} target=\${plan.target || '-'} chance=\${plan.chance ?? '-'} min=\${plan.minChance ?? '-'} energy=\${plan.energy ?? ''}/\${plan.requiredEnergy ?? ''}\`
    : '';
  return cardHtml(label, alive ? t('live', { pid: watcher.pid }) : t('stopped'), alive ? 'ok' : 'warn', \`\${t('started')}=\${watcher?.startedAt || '-'}\${planText}\`);
}

function effectiveWatcherHtml(label, watcher, profilesWatcher, enabled, plan) {
  if (!profilesWatcher?.alive) return watcherHtml(label, watcher, plan);
  if (!enabled) {
    return cardHtml(label, t('disabled_in_autopilot'), 'warn', \`pid=#\${profilesWatcher.pid || '-'} | \${t('started')}=\${profilesWatcher.startedAt || '-'} | \${t('per_profile_runtime')}\`);
  }
  return cardHtml(label, t('via_autopilot'), 'ok', \`pid=#\${profilesWatcher.pid || '-'} | \${t('started')}=\${profilesWatcher.startedAt || '-'} | \${t('per_profile_runtime')}\`);
}

function groupUpgradeHtml(accounts, profilesWatcher) {
  const armed = accounts.filter((account) => account.upgradeEnabled);
  const effectCounts = Object.fromEntries(UPGRADE_EFFECT_TYPES.map((type) => [
    type,
    armed.filter((account) => account.upgradeSelection?.[type]).length,
  ]));
  const effectText = UPGRADE_EFFECT_TYPES
    .filter((type) => effectCounts[type] > 0)
    .map((type) => \`+\${type.toUpperCase()} \${effectCounts[type]}\`)
    .join(' · ');
  const main = armed.length > 0 ? \`ARMED \${armed.length}/\${accounts.length}\` : t('off');
  const sub = effectText || \`\${t('via_autopilot')} · \${t('checkbox_disabled')}\`;
  return cardHtml(t('auto_upgrade'), main, armed.length > 0 ? 'ok' : 'warn', sub);
}

function renderGangWatchToggle(watcher, profilesWatcher, settings) {
  const input = $('gang-watch-toggle');
  const state = $('gang-watch-state');
  if (!input || !state) return;
  const viaAutopilot = Boolean(profilesWatcher?.alive);
  const enabledInAutopilot = settings?.gang?.enabled !== false;
  const live = Boolean(watcher?.alive) || (viaAutopilot && enabledInAutopilot);
  input.checked = enabledInAutopilot;
  state.textContent = viaAutopilot
    ? enabledInAutopilot
      ? t('via_autopilot')
      : t('disabled_in_autopilot')
    : watcher?.alive
      ? t('live', { pid: watcher.pid })
      : enabledInAutopilot
        ? t('armed_for_autopilot')
        : t('stopped');
  state.className = \`inline-status \${live ? 'ok' : 'warn'}\`;
}

function renderHeaderActivity(data) {
  const accounts = data.accounts || [];
  const settings = data.settings || {};
  const profilesLive = Boolean(data.watchers?.profiles?.alive);
  const heistLive = profilesLive || Boolean(data.watchers?.jewelry?.alive);
  const gangLive = Boolean(data.watchers?.gang?.alive) || (profilesLive && settings.gang?.enabled !== false);
  const enabledAccounts = accounts.filter((account) => account.automationEnabled);
  const sucLive = heistLive && enabledAccounts.some((account) => account.upgradeEnabled);
  const dailyLive = heistLive && Boolean(settings.daily?.enabled);

  setLiveClass('feature-profiles', profilesLive && enabledAccounts.length > 0);
  setLiveClass('feature-heists', heistLive && Boolean(settings.jewelry?.requireFullBudget));
  setLiveClass('feature-daily', dailyLive);
  setLiveClass('feature-suc', sucLive);
  setLiveClass('profiles-card', profilesLive);
  setLiveClass('gang-card', gangLive);
  setLiveClass('jewelry-card', Boolean(data.watchers?.jewelry?.alive) || profilesLive);
  setLiveClass('upgrade-card', sucLive);
  setLiveClass('session-card', profilesLive ? enabledAccounts.length > 0 : Boolean(data.gameState?.ok));

  const activityPanel = $('bot-activity');
  const anyWorkerLive = profilesLive || Boolean(data.watchers?.gang?.alive) || Boolean(data.watchers?.jewelry?.alive);
  activityPanel.classList.toggle('is-live', anyWorkerLive);
  $('bot-activity-state').textContent = profilesLive
    ? t('background_online')
    : anyWorkerLive
      ? t('background_legacy')
      : t('background_off');
  $('bot-runtime-meta').textContent =
    \`\${settings.profiles?.intervalSeconds ?? 3}s POLL · \${settings.jewelry?.energyBudget ?? 10} ENERGY · \${settings.jewelry?.runIntervalSeconds ?? 3}s RUN GAP · \${enabledAccounts.length}/\${accounts.length} SELECTED\`;

  const events = Array.isArray(data.activity) ? data.activity : [];
  $('bot-activity-feed').innerHTML = events.length
    ? events.slice(0, 5).map(activityEventHtml).join('')
    : \`<span class="activity-empty">\${escapeHtml(t('activity_waiting'))}</span>\`;
  requestAnimationFrame(() => clampBotActivityToViewport());
}

function setLiveClass(id, live) {
  const node = $(id);
  if (node) node.classList.toggle('is-live', Boolean(live));
}

function activityEventHtml(event) {
  const at = new Date(event.at);
  const time = Number.isNaN(at.getTime())
    ? '--:--:--'
    : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const account = event.accountId || 'active';
  let text = event.type || 'event';
  if (event.type === 'heist') {
    text = t('activity_heist', { account, target: event.target, progress: \`\${event.index}/\${event.total}\` });
  } else if (event.type === 'upgrade') {
    text = t('activity_upgrade', { account, effect: String(event.effect || 'upgrade').toUpperCase(), track: event.track, node: event.node, cost: event.cost });
  } else if (event.type === 'daily-contract') {
    text = t('activity_daily_contract', { account });
  } else if (event.type === 'daily-streak') {
    text = t('activity_daily_streak', { account, day: event.day });
  } else if (event.type === 'gang') {
    text = t('activity_gang', { account, count: event.count });
  } else if (event.type === 'tick') {
    text = t('activity_tick', { enabled: event.enabled, accounts: event.accounts, failed: event.failed });
  } else if (event.type === 'started') {
    text = t('activity_started', { interval: event.intervalSeconds });
  } else if (event.type === 'error') {
    text = t('activity_error', { account, category: event.category });
  }
  return \`<div class="activity-event \${event.type === 'error' ? 'is-error' : ''}"><span class="activity-time">\${escapeHtml(time)}</span><span class="activity-text">\${escapeHtml(text)}</span></div>\`;
}

function upgradeHtml(plan) {
  const next = plan.nextAffordable || plan.nextOverall;
  const selectedTypes = Array.isArray(plan.effectTypes) ? plan.effectTypes.map((type) => \`+\${String(type).toUpperCase()}\`).join(' / ') : '';
  if (!plan.enabled) {
    const preview = next ? \`\${t('next')}: \${next.track}:\${next.node} cost=\${next.cost} +\${String(next.type).toUpperCase()}=\${next.value}\` : t('no_known_suc');
    return cardHtml(t('auto_upgrade'), t('off'), 'warn', \`\${t('checkbox_disabled')} | \${preview}\`);
  }
  if (!plan.nextAffordable) {
    const waiting = plan.nextOverall
      ? \`\${selectedTypes} | \${t('waiting_for_loot')}: \${plan.nextOverall.track}:\${plan.nextOverall.node} cost=\${plan.nextOverall.cost}\`
      : \`\${selectedTypes} | \${t('no_eligible_suc')}\`;
    return cardHtml(t('auto_upgrade'), t('armed'), 'ok', waiting);
  }
  const up = plan.nextAffordable;
  return cardHtml(t('auto_upgrade'), \`+\${String(up.type).toUpperCase()} \${up.track}:\${up.node}\`, 'ok', \`\${selectedTypes} | cost=\${up.cost} value=\${up.value}\`);
}

function renderAccounts(accounts) {
  const effectiveAccounts = withOptimisticAutomation(accounts);
  const main = effectiveAccounts.find((account) => account.kind === 'main') || {
    id: 'main',
    kind: 'main',
    name: t('main_account'),
    active: true,
    automationEnabled: pendingAutomationByAccount.has('main') ? pendingAutomationByAccount.get('main') : true,
    automationPending: pendingAutomationByAccount.has('main'),
    hasCookie: false,
    proxy: { hasProxy: false },
    stats: { ok: false, reason: 'missing-cookie' },
  };
  const profiles = effectiveAccounts.filter((account) => account.kind === 'profile');
  $('main-account-card').innerHTML = accountCardHtml(main);
  $('profile-list').innerHTML = profiles.length
    ? profiles.map(accountCardHtml).join('')
    : \`<p class="muted empty-state">\${escapeHtml(t('no_profiles'))}</p>\`;
  const selectAll = $('select-all-accounts');
  if (selectAll) {
    const allSelected = effectiveAccounts.length > 0 && effectiveAccounts.every((account) => account.automationEnabled);
    selectAll.textContent = allSelected ? t('all_profiles_selected') : t('select_all_profiles');
    selectAll.disabled = selectAllAccountsSaving || allSelected;
  }
}

function withOptimisticAutomation(accounts) {
  return accounts.map((account) => {
    const upgradeSelection = { ...(account.upgradeSelection || {}) };
    const upgradePendingTypes = [];
    UPGRADE_EFFECT_TYPES.forEach((effectType) => {
      const key = \`\${account.id}:\${effectType}\`;
      if (pendingUpgradeByAccount.has(key)) {
        upgradeSelection[effectType] = pendingUpgradeByAccount.get(key);
        upgradePendingTypes.push(effectType);
      }
    });
    return {
      ...account,
      automationEnabled: pendingAutomationByAccount.has(account.id)
        ? pendingAutomationByAccount.get(account.id)
        : Boolean(account.automationEnabled),
      automationPending: pendingAutomationByAccount.has(account.id),
      upgradeSelection,
      upgradeEnabled: UPGRADE_EFFECT_TYPES.some((effectType) => Boolean(upgradeSelection[effectType])),
      upgradePendingTypes,
    };
  });
}

function accountCardHtml(account) {
  const stats = account.stats || {};
  const res = stats.resources || {};
  const isMain = account.kind === 'main';
  const proxyLabel = isMain
    ? t('direct_no_proxy')
    : account.proxy?.hasProxy ? account.proxy.maskedProxy : t('no_proxy_set');
  const tone = stats.ok ? 'ok' : account.hasCookie ? 'warn' : 'bad';
  const statusLine = stats.ok
    ? \`loot=\${res.loot} energy=\${res.energy} heat=\${res.heat} jail=\${res.jailLeft}\`
    : (stats.error || stats.reason || t('not_checked'));
  const plan = stats.jewelryPlan
    ? \`plan=\${stats.jewelryPlan.type} \${stats.jewelryPlan.reason || ''} target=\${stats.jewelryPlan.target || '-'} chance=\${stats.jewelryPlan.chance ?? '-'} min=\${stats.jewelryPlan.minChance ?? '-'}\`
    : t('plan_unknown');
  const nextUpgrade = stats.autoUpgrade?.nextAffordable;
  const upgrade = nextUpgrade
    ? \`next +\${String(nextUpgrade.type).toUpperCase()} \${nextUpgrade.track}:\${nextUpgrade.node} cost=\${nextUpgrade.cost}\`
    : t('next_suc_none');
  const upgradeSelection = account.upgradeSelection || {};
  const selectedUpgradeTypes = UPGRADE_EFFECT_TYPES
    .filter((effectType) => upgradeSelection[effectType])
    .map((effectType) => \`+\${effectType.toUpperCase()}\`);
  const upgradeSaving = Boolean(account.upgradePendingTypes?.length);
  const upgradeOptions = UPGRADE_EFFECT_TYPES.map((effectType) => {
    return \`<label class="upgrade-option"><input type="checkbox" data-account-upgrade-effect="\${effectType}" data-account-id="\${escapeHtml(account.id)}" \${upgradeSelection[effectType] ? 'checked' : ''} \${upgradeSaving ? 'disabled' : ''}><span>+\${effectType.toUpperCase()}</span></label>\`;
  }).join('');
  const isSelected = Boolean(account.automationEnabled);
  const selectionDisabled = account.automationPending || selectAllAccountsSaving ? 'disabled' : '';
  return \`
    <div class="profile-item account-item \${isSelected ? 'selected-account' : ''} \${isMain ? 'main-profile' : ''}">
      <div class="profile-title">
        <div>
          <div class="account-name">\${escapeHtml(account.name)}</div>
          <div class="muted account-meta">\${isMain ? t('main') : \`id=\${escapeHtml(account.id)}\`} | \${t('cookie')}=\${account.hasCookie ? t('saved') : t('missing')} | \${t('proxy')}=\${escapeHtml(proxyLabel)}</div>
        </div>
        <label class="account-run-select" title="\${escapeHtml(t('active_account_toggle'))}">
          <input type="checkbox" data-account-automation="1" data-account-id="\${escapeHtml(account.id)}" \${isSelected ? 'checked' : ''} \${selectionDisabled}>
          <span>\${escapeHtml(t('run_together'))}</span>
        </label>
      </div>
      <div class="stat-grid">
        <div><span>\${escapeHtml(t('loot'))}</span><strong>\${stats.ok ? escapeHtml(res.loot) : '-'}</strong></div>
        <div><span>\${escapeHtml(t('energy'))}</span><strong>\${stats.ok ? escapeHtml(res.energy) : '-'}</strong></div>
        <div><span>\${escapeHtml(t('heat'))}</span><strong class="\${Number(res.heat || 0) >= 45 ? 'bad' : ''}">\${stats.ok ? escapeHtml(res.heat) : '-'}</strong></div>
        <div><span>\${escapeHtml(t('next_stat'))}</span><strong>\${stats.ok ? escapeHtml(res.nextEnergyIn) : '-'}</strong></div>
      </div>
      <p class="muted \${tone}">\${escapeHtml(statusLine)}</p>
      <p class="muted small-line">\${escapeHtml(plan)} | \${escapeHtml(upgrade)}</p>
      <div class="upgrade-selector">
        <div class="upgrade-selector-head">
          <span>\${escapeHtml(t('auto_upgrade_account'))}</span>
          <small>\${escapeHtml(t('selected_upgrade_types', { types: selectedUpgradeTypes.join(' / ') || 'OFF' }))}</small>
        </div>
        <div class="upgrade-options">\${upgradeOptions}</div>
      </div>
      <div class="row">
        \${isMain
          ? \`<button class="button mini ghost" data-main-action="cookie">\${escapeHtml(t('update_main_cookie'))}</button><button class="button mini danger" data-main-action="clear">\${escapeHtml(t('clear_main_cookie'))}</button>\`
          : \`<button class="button mini ghost" data-profile-action="cookie" data-profile-id="\${escapeHtml(account.id)}">\${escapeHtml(t('update_cookie'))}</button><button class="button mini ghost" data-profile-action="proxy" data-profile-id="\${escapeHtml(account.id)}">\${escapeHtml(t('update_proxy'))}</button><button class="button mini ghost" data-profile-action="clear-proxy" data-profile-id="\${escapeHtml(account.id)}">\${escapeHtml(t('clear_proxy'))}</button><button class="button mini danger" data-profile-action="delete" data-profile-id="\${escapeHtml(account.id)}">\${escapeHtml(t('delete'))}</button>\`}
      </div>
      \${isMain ? \`<input id="main-cookie-input" class="secret-inline" type="password" autocomplete="off" spellcheck="false" placeholder="\${escapeHtml(t('main_cookie_placeholder'))}">\` : ''}
    </div>
  \`;
}

function readSettings() {
  return {
    gang: {
      enabled: $('gang-watch-toggle').checked,
      intervalSeconds: Number($('gang-interval').value || 5),
      notify: $('gang-notify').checked,
      minEarned: Number($('gang-min-earned').value || 0),
      max: $('gang-max').value ? Number($('gang-max').value) : null,
    },
    jewelry: {
      intervalSeconds: Number($('jewelry-interval').value || 660),
      runIntervalSeconds: Number($('jewelry-run-interval').value || 3),
      energyBudget: Number($('jewelry-energy').value || 10),
      heatCap: Number($('jewelry-heat-cap').value || 45),
      targetMode: $('jewelry-target-mode').value === 'stable-ev' ? 'stable-ev' : 'lowest-safe-chance',
      minChance: Number($('jewelry-min-chance').value || 24),
      targetKey: 'jewelry',
      requireFullBudget: $('jewelry-full-budget').checked,
    },
    upgrade: {
      enabled: false,
      mode: 'cheapest-success',
      maxPerTick: 10,
      lootReserve: 0,
    },
    daily: {
      enabled: $('daily-auto-claim').checked,
      requireZeroEnergy: true,
      claimStreak: true,
      claimContracts: true,
    },
    automationByAccount: currentAutomationByAccount(),
    upgradeByAccount: currentUpgradeByAccount(),
  };
}

function currentAutomationByAccount() {
  const out = {};
  document.querySelectorAll('[data-account-automation]').forEach((input) => {
    out[input.dataset.accountId] = { enabled: input.checked };
  });
  return out;
}

function currentUpgradeByAccount() {
  const out = {};
  document.querySelectorAll('[data-account-upgrade-effect]').forEach((input) => {
    out[input.dataset.accountId] ||= Object.fromEntries(UPGRADE_EFFECT_TYPES.map((effectType) => [effectType, false]));
    out[input.dataset.accountId][input.dataset.accountUpgradeEffect] = input.checked;
  });
  return out;
}

async function saveSettings() {
  clearTimeout(settingsSaveTimer);
  const json = await api('/api/settings', { method: 'POST', body: JSON.stringify({ settings: readSettings() }) });
  settingsDirty = false;
  log({ savedSettings: json.settings });
  await refresh();
}

function scheduleSettingsSave() {
  settingsDirty = true;
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    saveSettings().catch((error) => {
      settingsDirty = false;
      log({ error: error.message });
      refresh().catch(() => {});
    });
  }, 250);
}

async function watcherAction(target, action) {
  await saveSettings();
  const json = await api(\`/api/watchers/\${target}/\${action}\`, { method: 'POST', body: '{}' });
  log(json);
  await forceRefresh();
}

async function toggleGangAutoAccept(enabled) {
  const input = $('gang-watch-toggle');
  input.disabled = true;
  try {
    const json = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: readSettings() })
    });
    log({ gangAutoAccept: { enabled, mode: 'profiles-config' }, settings: json.settings });
    await forceRefresh();
  } finally {
    input.disabled = false;
  }
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => watcherAction(button.dataset.target, button.dataset.action).catch((error) => log({ error: error.message })));
});

$('gang-watch-toggle').addEventListener('change', () => {
  toggleGangAutoAccept($('gang-watch-toggle').checked).catch(async (error) => {
    log({ error: error.message });
    await forceRefresh().catch(() => {});
  });
});

document.querySelectorAll('[data-lang]').forEach((button) => {
  button.addEventListener('click', () => {
    applyLanguage(button.dataset.lang);
    if (lastDashboard && !isEditingForm()) renderDashboard(lastDashboard, { force: true });
  });
});

[
  'gang-interval',
  'gang-min-earned',
  'gang-max',
  'gang-notify',
  'jewelry-energy',
  'jewelry-interval',
  'jewelry-run-interval',
  'jewelry-heat-cap',
  'jewelry-target-mode',
  'jewelry-min-chance',
  'jewelry-full-budget',
  'daily-auto-claim',
].forEach((id) => {
  const input = $(id);
  if (input) input.addEventListener('change', scheduleSettingsSave);
});

$('refresh').addEventListener('click', () => forceRefresh().catch((error) => log({ error: error.message })));
$('status-toggle').addEventListener('click', () => {
  setStatusPanelExpanded(!statusPanelExpanded);
});
$('refresh-accounts').addEventListener('click', () => forceRefresh().catch((error) => log({ error: error.message })));
$('select-all-accounts').addEventListener('click', () => {
  selectAllAccounts().catch((error) => log({ error: error.message }));
});
$('start-all-profiles').addEventListener('click', () => {
  startAllProfiles().catch((error) => log({ error: error.message }));
});
$('clear-output').addEventListener('click', () => { $('output').textContent = ''; });

$('main-account-card').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-main-action]');
  if (!button) return;
  const action = button.dataset.mainAction;
  try {
    if (action === 'activate') {
      log(await api('/api/main/activate', { method: 'POST', body: '{}' }));
    } else if (action === 'cookie') {
      const input = $('main-cookie-input');
      const cookie = input?.value || '';
      if (!cookie) throw new Error(t('paste_main_cookie'));
      log(await api('/api/main/cookie', { method: 'POST', body: JSON.stringify({ cookie }) }));
      input.value = '';
    } else if (action === 'clear') {
      if (!confirm(t('clear_main_confirm'))) return;
      log(await api('/api/main/clear', { method: 'POST', body: '{}' }));
    }
    await forceRefresh();
  } catch (error) {
    log({ error: error.message });
  }
});

$('main-account-card').addEventListener('change', (event) => {
  handleAccountAutomationToggle(event).catch((error) => log({ error: error.message }));
  handleAccountUpgradeToggle(event).catch((error) => log({ error: error.message }));
});

$('add-profile').addEventListener('click', async () => {
  const name = $('profile-name').value;
  const cookie = $('profile-cookie').value;
  const proxy = $('profile-proxy').value;
  try {
    const json = await api('/api/profiles/add', {
      method: 'POST',
      body: JSON.stringify({ name, cookie, proxy, setActive: true })
    });
    $('profile-name').value = '';
    $('profile-cookie').value = '';
    $('profile-proxy').value = '';
    log({ addedProfile: json.profile });
    await forceRefresh();
  } catch (error) {
    log({ error: error.message });
  }
});

$('profile-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-profile-action]');
  if (!button) return;
  const action = button.dataset.profileAction;
  const id = button.dataset.profileId;
  try {
    if (action === 'activate') {
      log(await api(\`/api/profiles/\${id}/activate\`, { method: 'POST', body: '{}' }));
    } else if (action === 'delete') {
      if (!confirm(t('delete_profile_confirm'))) return;
      log(await api(\`/api/profiles/\${id}/delete\`, { method: 'POST', body: '{}' }));
    } else if (action === 'cookie') {
      const cookie = $('profile-cookie').value;
      if (!cookie) throw new Error(t('paste_profile_cookie'));
      log(await api(\`/api/profiles/\${id}/cookie\`, { method: 'POST', body: JSON.stringify({ cookie }) }));
      $('profile-cookie').value = '';
    } else if (action === 'proxy') {
      const proxy = $('profile-proxy').value;
      if (!proxy) throw new Error(t('paste_profile_proxy'));
      log(await api(\`/api/profiles/\${id}/proxy\`, { method: 'POST', body: JSON.stringify({ proxy }) }));
      $('profile-proxy').value = '';
    } else if (action === 'clear-proxy') {
      log(await api(\`/api/profiles/\${id}/proxy\`, { method: 'POST', body: JSON.stringify({ proxy: '' }) }));
    }
    await forceRefresh();
  } catch (error) {
    log({ error: error.message });
  }
});

$('profile-list').addEventListener('change', (event) => {
  handleAccountAutomationToggle(event).catch((error) => log({ error: error.message }));
  handleAccountUpgradeToggle(event).catch((error) => log({ error: error.message }));
});

async function handleAccountAutomationToggle(event) {
  const input = event.target.closest('[data-account-automation]');
  if (!input) return;
  const accountId = input.dataset.accountId;
  const enabled = input.checked;
  pendingAutomationByAccount.set(accountId, enabled);
  if (lastDashboard) renderDashboard(lastDashboard, { force: true });
  try {
    await api('/api/account-automation', {
      method: 'POST',
      body: JSON.stringify({ accountId, enabled })
    });
    setLocalAutomationStates([[accountId, enabled]]);
    log({ accountAutomation: { accountId, enabled } });
    forceRefresh().catch((error) => log({ refreshWarning: error.message }));
  } catch (error) {
    pendingAutomationByAccount.delete(accountId);
    if (lastDashboard) renderDashboard(lastDashboard, { force: true });
    throw error;
  }
}

async function selectAllAccounts() {
  const accounts = lastDashboard?.accounts || [];
  if (!accounts.length || selectAllAccountsSaving) return;
  selectAllAccountsSaving = true;
  accounts.forEach((account) => pendingAutomationByAccount.set(account.id, true));
  renderDashboard(lastDashboard, { force: true });
  try {
    await api('/api/accounts-automation', {
      method: 'POST',
      body: JSON.stringify({ enabled: true })
    });
    setLocalAutomationStates(accounts.map((account) => [account.id, true]));
    log({ accountAutomation: { allProfiles: true, count: accounts.length } });
    await forceRefresh();
  } catch (error) {
    accounts.forEach((account) => pendingAutomationByAccount.delete(account.id));
    selectAllAccountsSaving = false;
    renderDashboard(lastDashboard, { force: true });
    throw error;
  }
}

async function startAllProfiles() {
  const button = $('start-all-profiles');
  button.disabled = true;
  try {
    await selectAllAccounts();
    await watcherAction('profiles', 'start');
  } finally {
    button.disabled = false;
  }
}

function setLocalAutomationStates(entries) {
  selectAllAccountsSaving = false;
  if (!lastDashboard?.accounts) return;
  const updates = new Map(entries);
  lastDashboard = {
    ...lastDashboard,
    accounts: lastDashboard.accounts.map((account) => ({
      ...account,
      automationEnabled: updates.has(account.id) ? updates.get(account.id) : account.automationEnabled,
      automationPending: false,
    })),
  };
  renderDashboard(lastDashboard, { force: true });
}

async function handleAccountUpgradeToggle(event) {
  const input = event.target.closest('[data-account-upgrade-effect]');
  if (!input) return;
  const accountId = input.dataset.accountId;
  const effectType = input.dataset.accountUpgradeEffect;
  const enabled = input.checked;
  const pendingKey = \`\${accountId}:\${effectType}\`;
  pendingUpgradeByAccount.set(pendingKey, enabled);
  if (lastDashboard) renderDashboard(lastDashboard, { force: true });
  try {
    const json = await api('/api/account-upgrade', {
      method: 'POST',
      body: JSON.stringify({ accountId, effectType, enabled })
    });
    setLocalUpgradeEffectState(accountId, effectType, enabled);
    log({ accountUpgrade: { accountId, effectType, enabled }, settings: json.settings });
    forceRefresh().catch((error) => log({ refreshWarning: error.message }));
  } catch (error) {
    pendingUpgradeByAccount.delete(pendingKey);
    if (lastDashboard) renderDashboard(lastDashboard, { force: true });
    throw error;
  }
}

function setLocalUpgradeEffectState(accountId, effectType, enabled) {
  if (!lastDashboard?.accounts) return;
  lastDashboard = {
    ...lastDashboard,
    accounts: lastDashboard.accounts.map((account) => {
      if (account.id !== accountId) return account;
      const upgradeSelection = {
        ...(account.upgradeSelection || {}),
        [effectType]: Boolean(enabled),
      };
      return {
        ...account,
        upgradeSelection,
        upgradeEnabled: UPGRADE_EFFECT_TYPES.some((type) => Boolean(upgradeSelection[type])),
      };
    }),
  };
  renderDashboard(lastDashboard, { force: true });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

applyLanguage(currentLang);
initBotActivityDrag();
restoreBotActivityPosition();
forceRefresh().catch((error) => log({ error: error.message }));
setInterval(() => refresh().catch(() => {}), 5000);
`;
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
