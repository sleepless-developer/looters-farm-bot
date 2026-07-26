import test from "node:test";
import assert from "node:assert/strict";
import { parseSafeActivityLine, startWebUiServer } from "../src/webUi.js";
import { loadSettings, saveSettings } from "../src/settings.js";

test("local web UI serves dashboard shell and blocks POST without CSRF", async () => {
  const originalSettings = await loadSettings();
  const { server, url } = await startWebUiServer({ port: 0 });
  try {
    const html = await fetch(url).then((response) => response.text());
    assert.match(html, /Looters Control Deck/);
    assert.match(html, /csrf-token/);
    assert.match(html, /Main account \+ proxy profiles/);
    assert.match(html, /Proxy: http:\/\/user:pass@host:port/);
    assert.match(html, /Lowest safe chance/);
    assert.match(html, /Min success chance %/);
    assert.match(html, /Auto-claim daily reward\/contracts at 0 energy/);
    assert.match(html, /Autopilot scheduler/);
    assert.match(html, /class="scheduler-actions"/);
    assert.doesNotMatch(html, /<h2 data-i18n="profiles_title">/);
    assert.match(html, /data-lang="ru"/);
    assert.match(html, /data-lang="en"/);
    assert.match(html, /data-i18n="hero_subtitle"/);
    assert.match(html, /data-i18n="chip_daily"/);
    assert.match(html, /id="gang-watch-toggle"/);
    assert.match(html, /id="select-all-accounts"/);
    assert.match(html, /id="bot-activity"/);
    assert.match(html, /<aside id="bot-activity"/);
    assert.match(html, /id="status-toggle"[\s\S]*aria-expanded="false"/);
    assert.match(html, /id="status-panel" class="status-drawer" aria-hidden="true"/);
    assert.match(html, /class="grid two settings-grid"/);
    assert.match(html, /id="jewelry-run-interval"/);
    assert.match(html, /id="start-all-profiles"/);
    assert.match(html, /Start selected/);
    assert.doesNotMatch(html, /data-target="gang"/);
    assert.doesNotMatch(html, /data-target="jewelry"/);
    assert.doesNotMatch(html, /data-target="all"/);
    assert.doesNotMatch(html, /Single-active watchers/);
    assert.doesNotMatch(html, /data-action="restart"/);
    assert.doesNotMatch(html, /Fixed target/);
    const js = await fetch(`${url}/app.js`).then((response) => response.text());
    assert.match(js, /Auto-upgrade by lowest price/);
    assert.match(js, /data-account-upgrade-effect/);
    assert.match(js, /UPGRADE_EFFECT_TYPES = \['suc', 'heat', 'pay', 'regen'\]/);
    assert.match(js, /setLocalUpgradeEffectState/);
    assert.match(js, /ALL PROFILES/);
    assert.match(js, /looters-ui-language/);
    assert.match(js, /function applyLanguage/);
    assert.match(js, /let statusPanelExpanded = false/);
    assert.match(js, /function setStatusPanelExpanded/);
    assert.match(js, /show_status: 'Show status'/);
    assert.match(js, /hide_status: 'Hide status'/);
    assert.match(js, /setStatusPanelExpanded\(!statusPanelExpanded\)/);
    assert.match(js, /account-run-select/);
    assert.match(js, /Run together/);
    assert.match(js, /data-account-automation/);
    assert.match(js, /handleAccountAutomationToggle/);
    assert.match(js, /pendingAutomationByAccount/);
    assert.match(js, /setLocalAutomationStates/);
    assert.match(js, /dashboardRequestSequence/);
    assert.match(js, /latestAppliedDashboardRequest/);
    assert.match(js, /reconcilePendingAccountSelections/);
    assert.match(js, /selectAllAccounts/);
    assert.match(js, /renderHeaderActivity/);
    assert.match(js, /activityEventHtml/);
    assert.match(js, /BOT_ACTIVITY_POSITION_KEY/);
    assert.match(js, /initBotActivityDrag/);
    assert.match(js, /clampBotActivityToViewport/);
    assert.match(js, /setPointerCapture/);
    assert.doesNotMatch(js, /pendingActiveAccountId/);
    assert.match(js, /toggleGangAutoAccept/);
    assert.match(js, /mode: 'profiles-config'/);
    assert.match(js, /startAllProfiles/);
    assert.match(js, /effectiveWatcherHtml/);
    assert.match(js, /groupUpgradeHtml/);
    assert.match(js, /VIA AUTOPILOT/);
    assert.doesNotMatch(js, /watcherToggle\('gang'/);
    assert.doesNotMatch(js, /watcherAction\('gang'/);
    assert.doesNotMatch(js, /jewelry-target-key/);
    const css = await fetch(`${url}/app.css`).then((response) => response.text());
    assert.match(css, /minmax\(min\(100%, 420px\), 1fr\)/);
    assert.match(css, /overflow-wrap: anywhere/);
    assert.match(css, /\.profile-item \.row/);
    assert.match(css, /\.lang-switch/);
    assert.match(css, /\.account-run-select:has\(input:checked\)/);
    assert.match(css, /\.run-toggle/);
    assert.match(css, /\.account-run-select/);
    assert.match(css, /\.feature-chip\.is-live/);
    assert.match(css, /\.bot-activity\.is-live/);
    assert.match(css, /\.bot-activity\.is-dragging/);
    assert.match(css, /\.bot-activity \{[\s\S]*position: fixed/);
    assert.match(css, /max-height: calc\(100vh - 24px\)/);
    assert.match(css, /\.bot-activity-head \{[\s\S]*cursor: grab/);
    assert.match(css, /\.shell \{ width: min\(1180px, calc\(100vw - 32px\)\); margin: 0 auto;/);
    assert.doesNotMatch(css, /margin-right: 358px/);
    assert.match(css, /\.upgrade-options/);
    assert.match(css, /\.upgrade-option:has\(input:checked\)/);
    assert.match(css, /\.scheduler-actions/);
    assert.match(css, /\.settings-grid \{ align-items: start; \}/);
    assert.match(css, /\.status-drawer \{[\s\S]*grid-template-rows: 0fr/);
    assert.match(css, /\.status-drawer\.is-open \{[\s\S]*grid-template-rows: 1fr/);
    assert.match(css, /\.status-grid \{[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.signal \{[\s\S]*aspect-ratio: 1/);
    assert.doesNotMatch(css, /\.status-grid, \.two/);

    const blocked = await fetch(`${url}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: originalSettings }),
    });
    assert.equal(blocked.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await saveSettings(originalSettings);
  }
});

test("safe activity parser accepts only whitelisted event shapes", () => {
  const event = parseSafeActivityLine("[2026-07-26T12:29:33.561Z] jewelry-heist accountId=alt_1 target=jewelry index=2 total=5");
  assert.deepEqual(event, {
    at: "2026-07-26T12:29:33.561Z",
    accountId: "alt_1",
    type: "heist",
    target: "jewelry",
    index: 2,
    total: 5,
  });
  assert.deepEqual(
    parseSafeActivityLine("[2026-07-26T12:30:00.000Z] auto-upgrade accountId=alt_1 track=mask node=3 cost=195 effect=heat"),
    {
      at: "2026-07-26T12:30:00.000Z",
      accountId: "alt_1",
      type: "upgrade",
      track: "mask",
      node: 3,
      cost: 195,
      effect: "heat",
    },
  );
  assert.equal(parseSafeActivityLine("[2026-07-26T12:29:33.561Z] cookie-dump secret=value"), null);
  assert.equal(parseSafeActivityLine("not a safe runtime line"), null);
});

test("local web UI settings endpoint accepts CSRF-protected non-secret settings", async () => {
  const originalSettings = await loadSettings();
  const { server, url } = await startWebUiServer({ port: 0 });
  try {
    const html = await fetch(url).then((response) => response.text());
    const token = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
    assert.ok(token);

    const next = structuredClone(originalSettings);
    next.gang.intervalSeconds = 6;
    next.upgrade = { enabled: true, mode: "cheapest-success", maxPerTick: 10, lootReserve: 0 };
    next.automationByAccount = {};
    next.upgradeByAccount = {};
    const response = await fetch(`${url}/api/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": token,
      },
      body: JSON.stringify({ settings: next }),
    });
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.settings.gang.intervalSeconds, 6);
    assert.equal(json.settings.upgrade.enabled, true);
    assert.deepEqual(json.settings.automationByAccount, originalSettings.automationByAccount);
    assert.deepEqual(json.settings.upgradeByAccount, originalSettings.upgradeByAccount);
    assert.equal(JSON.stringify(json).includes("PHPSESSID"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await saveSettings(originalSettings);
  }
});
