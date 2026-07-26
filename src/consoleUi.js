import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { safeLogObject } from "./redact.js";
import { LootersApiClient } from "./apiClient.js";
import { clearSessionCookie, hasSessionCookie, loadActiveProfileProxyUrl, loadSessionCookie, promptAndSaveSessionCookie, sessionBlobPath } from "./vault.js";
import { planJewelryHeistBatch } from "./jewelry.js";
import { loadSettings, saveSettings, settingsPath } from "./settings.js";
import { restartWatcher, startWatcher, stopWatcher, watcherStatuses } from "./processManager.js";

export async function runConsoleUi() {
  console.log("\nLooters Bot Console UI");
  console.log("Cookie/session values are never printed. Cookie updates use hidden DPAPI input.\n");

  while (true) {
    const settings = await loadSettings();
    console.log("\n=== Main Menu ===");
    console.log("1) Safe status dashboard");
    console.log("2) Configure gang auto-accept");
    console.log("3) Configure jewelry energy scheduler");
    console.log("4) Cookie credentials");
    console.log("5) Start watchers with saved settings");
    console.log("6) Stop watchers");
    console.log("7) Reload watchers (only recovery/code changes)");
    console.log("8) Show saved settings");
    console.log("0) Exit");

    const choice = await ask("Select: ");
    if (choice === "0") return;
    if (choice === "1") await showDashboard(settings);
    else if (choice === "2") await configureGang(settings);
    else if (choice === "3") await configureJewelry(settings);
    else if (choice === "4") await credentialsMenu();
    else if (choice === "5") await startMenu(settings);
    else if (choice === "6") await stopMenu();
    else if (choice === "7") await restartMenu(settings);
    else if (choice === "8") console.log(safeLogObject({ settingsPath: await settingsPath(), settings }));
    else console.log("Unknown menu item.");
  }
}

async function showDashboard(settings) {
  const statuses = await watcherStatuses();
  const dashboard = {
    vault: {
      hasSessionCookie: await hasSessionCookie(),
      path: sessionBlobPath(),
    },
    watchers: {
      gang: {
        pid: statuses.gang.pid,
        alive: statuses.gang.alive,
        startedAt: statuses.gang.startedAt,
      },
      jewelry: {
        pid: statuses.jewelry.pid,
        alive: statuses.jewelry.alive,
        startedAt: statuses.jewelry.startedAt,
      },
      profiles: {
        pid: statuses.profiles.pid,
        alive: statuses.profiles.alive,
        startedAt: statuses.profiles.startedAt,
      },
    },
    settings,
  };

  try {
    const api = await makeApi();
    const me = await api.get("me");
    if (!me?.player) {
      dashboard.session = { ok: false, reason: "player object missing / not signed in" };
    } else {
      dashboard.session = {
        ok: true,
        resources: {
          loot: me.player.loot,
          energy: me.player.energy,
          heat: me.player.heat,
          jailLeft: me.player.jailLeft,
          nextEnergyIn: me.player.nextEnergyIn,
        },
        jewelryPlan: planJewelryHeistBatch(me.player, settings.jewelry),
      };
    }
  } catch (error) {
    dashboard.session = { ok: false, error: error.message };
  }

  console.log(safeLogObject(dashboard));
}

async function configureGang(settings) {
  const next = structuredClone(settings);
  console.log("\nGang auto-accept settings");
  next.gang.enabled = await askBoolean("Enable gang auto-accept inside multi-profile autopilot", next.gang.enabled);
  next.gang.intervalSeconds = await askNumber("Check interval seconds", next.gang.intervalSeconds, { min: 1 });
  next.gang.notify = await askBoolean("Desktop notification for accepted requests", next.gang.notify);
  next.gang.minEarned = await askNumber("Min earned filter", next.gang.minEarned, { min: 0 });
  next.gang.max = await askOptionalNumber("Max accepted per tick (blank = all)", next.gang.max, { min: 1 });
  await saveSettings(next);
  console.log("Saved gang settings.");
}

async function configureJewelry(settings) {
  const next = structuredClone(settings);
  console.log("\nJewelry energy scheduler settings");
  next.jewelry.energyBudget = await askNumber("Energy budget", next.jewelry.energyBudget, { min: 1 });
  next.jewelry.requireFullBudget = await askBoolean("Run only after full energy budget is available", next.jewelry.requireFullBudget);
  next.jewelry.intervalSeconds = await askNumber("Check interval seconds", next.jewelry.intervalSeconds, { min: 1 });
  next.jewelry.runIntervalSeconds = await askNumber("Seconds between heists inside a batch", next.jewelry.runIntervalSeconds, { min: 1 });
  next.jewelry.heatCap = await askNumber("Heat cap", next.jewelry.heatCap, { min: 0 });
  next.jewelry.targetMode = await askTargetMode("Target mode", next.jewelry.targetMode);
  next.jewelry.minChance = await askNumber("Minimum success chance %", next.jewelry.minChance, { min: 0, max: 100 });
  next.daily.enabled = await askBoolean("Auto-claim daily reward/contracts only at 0 energy", next.daily.enabled);
  await saveSettings(next);
  console.log("Saved jewelry settings.");
}

async function credentialsMenu() {
  while (true) {
    console.log("\nCookie credentials");
    console.log("1) Vault status");
    console.log("2) Set/update Cookie header (hidden input)");
    console.log("3) Clear saved Cookie");
    console.log("0) Back");
    const choice = await ask("Select: ");
    if (choice === "0") return;
    if (choice === "1") {
      console.log(safeLogObject({ hasSessionCookie: await hasSessionCookie(), path: sessionBlobPath() }));
    } else if (choice === "2") {
      console.log("Paste full Cookie header from DevTools -> Network -> /api/game.php -> Request Headers -> Cookie.");
      await promptAndSaveSessionCookie();
      console.log("Encrypted cookie saved in CurrentUser DPAPI vault.");
    } else if (choice === "3") {
      if (await askBoolean("Clear saved encrypted cookie", false)) {
        await clearSessionCookie();
        console.log("Encrypted cookie removed.");
      }
    } else {
      console.log("Unknown menu item.");
    }
  }
}

async function startMenu(settings) {
  const target = await askWatcherTarget("Start which watcher");
  const names = target === "all" ? ["gang", "jewelry"] : [target];
  for (const name of names) {
    console.log(safeLogObject(await startWatcher(name, settings)));
  }
}

async function stopMenu() {
  const target = await askWatcherTarget("Stop which watcher");
  const names = target === "all" ? ["gang", "jewelry"] : [target];
  for (const name of names) {
    console.log(safeLogObject(await stopWatcher(name)));
  }
}

async function restartMenu(settings) {
  const target = await askWatcherTarget("Reload which watcher");
  const names = target === "all" ? ["gang", "jewelry"] : [target];
  for (const name of names) {
    console.log(safeLogObject(await restartWatcher(name, settings)));
  }
}

async function askWatcherTarget(label) {
  console.log(`${label}:`);
  console.log("1) gang");
  console.log("2) jewelry");
  console.log("3) profiles");
  console.log("4) all single-active");
  const choice = await ask("Select: ");
  if (choice === "1") return "gang";
  if (choice === "2") return "jewelry";
  if (choice === "3") return "profiles";
  if (choice === "4") return "all";
  throw new Error("Unknown watcher selection.");
}

async function makeApi() {
  const cookie = await loadSessionCookie();
  return new LootersApiClient({ cookie, proxyUrl: await loadActiveProfileProxyUrl() });
}

async function ask(prompt) {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function askNumber(label, current, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const answer = await ask(`${label} [${current}]: `);
  if (!answer) return current;
  const n = Number(answer);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.log(`Invalid number, keeping ${current}.`);
    return current;
  }
  return n;
}

async function askTargetMode(label, current) {
  console.log(`${label}:`);
  console.log("1) lowest-safe-chance (minimal chance but not below threshold)");
  console.log("2) stable-ev (best EV / energy)");
  const normalizedCurrent = current === "stable-ev" ? "stable-ev" : "lowest-safe-chance";
  const answer = await ask(`Select [${normalizedCurrent}]: `);
  if (!answer) return normalizedCurrent;
  if (answer === "1" || answer === "lowest-safe-chance") return "lowest-safe-chance";
  if (answer === "2" || answer === "stable-ev") return "stable-ev";
  console.log(`Invalid mode, keeping ${normalizedCurrent}.`);
  return normalizedCurrent;
}

async function askOptionalNumber(label, current, { min = Number.NEGATIVE_INFINITY } = {}) {
  const shown = current == null ? "all" : current;
  const answer = await ask(`${label} [${shown}]: `);
  if (!answer) return current;
  if (answer.toLowerCase() === "all" || answer.toLowerCase() === "none") return null;
  const n = Number(answer);
  if (!Number.isFinite(n) || n < min) {
    console.log(`Invalid number, keeping ${shown}.`);
    return current;
  }
  return n;
}

async function askBoolean(label, current) {
  const answer = (await ask(`${label} [${current ? "Y/n" : "y/N"}]: `)).toLowerCase();
  if (!answer) return current;
  if (["y", "yes", "да", "д"].includes(answer)) return true;
  if (["n", "no", "нет", "н"].includes(answer)) return false;
  console.log(`Invalid answer, keeping ${current}.`);
  return current;
}
