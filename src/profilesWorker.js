import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { LootersApiClient, safeErrorSummary } from "./apiClient.js";
import { acceptGangRequests } from "./gang.js";
import { runJewelryHeistTick } from "./jewelry.js";
import { acquireLock } from "./lock.js";
import { accountAutomationEnabled, accountUpgradeEffectTypes, loadSettings } from "./settings.js";
import { appDataDir, listSessionAccounts, loadSessionAccountCredentials } from "./vault.js";
import { claimDailyRewards } from "./daily.js";

const DEFAULTS = Object.freeze({
  dryRun: true,
  once: false,
  intervalSeconds: 5,
  timeoutMs: 15000,
  gang: true,
  heist: true,
  daily: true,
  notify: false,
  lock: true,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profileLog(message, data = {}) {
  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);
  const line = `[${new Date().toISOString()}] ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`;
  console.log(line);
  writeProfileRuntimeLog(line).catch(() => {});
}

async function writeProfileRuntimeLog(line) {
  await mkdir(appDataDir(), { recursive: true });
  await appendFile(join(appDataDir(), "profiles-runtime.safe.log"), `${line}\n`, "utf8");
}

function withDefaults(options = {}) {
  const opts = { ...DEFAULTS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }
  return opts;
}

function publicAccount(account) {
  return {
    id: account.id,
    kind: account.kind,
    name: account.name,
    active: Boolean(account.active),
    hasCookie: Boolean(account.hasCookie),
    proxy: account.proxy ?? { hasProxy: false, maskedProxy: null },
  };
}

function summarizeGang(result) {
  if (!result) return null;
  return {
    found: result.found,
    selected: result.selected,
    accepted: result.results?.filter((row) => row.accepted).length ?? 0,
    dryRun: Boolean(result.dryRun),
  };
}

function summarizeHeist(waitSeconds, skipped = null) {
  if (skipped) return skipped;
  return {
    checked: true,
    nextCheckSeconds: waitSeconds,
  };
}

function summarizeDaily(result) {
  if (!result) return null;
  return {
    checked: Boolean(result.checked),
    reason: result.reason,
    energy: result.energy,
    streakAttempted: Boolean(result.streakAttempted),
    streakClaimed: Boolean(result.streakClaimed),
    contractsFound: result.contractsFound ?? 0,
    contractsClaimed: result.contractsClaimed ?? 0,
    dryRun: Boolean(result.dryRun),
  };
}

export async function checkAllProfiles(settings, options = {}) {
  const opts = withDefaults(options);
  const accounts = opts.accounts ?? await listSessionAccounts();
  const settled = await Promise.allSettled(accounts.map((account) => checkOneProfile(account, settings, opts)));
  return {
    ok: settled.every((row) => row.status === "fulfilled" && row.value.ok),
    accounts: settled.map((row, index) => row.status === "fulfilled"
      ? row.value
      : {
          ok: false,
          account: publicAccount(accounts[index]),
          error: safeErrorSummary(row.reason),
        }),
  };
}

async function checkOneProfile(account, settings, options) {
  const safeAccount = publicAccount(account);
  if (!safeAccount.hasCookie) {
    return { ok: false, account: safeAccount, reason: "missing-cookie" };
  }

  try {
    const credential = await loadCredential(account, options);
    const api = makeApi(credential, options);
    const me = await api.get("me");
    if (!me?.player) return { ok: false, account: safeAccount, reason: "player object missing / not signed in" };
    return {
      ok: true,
      account: safeAccount,
      resources: {
        loot: me.player.loot,
        energy: me.player.energy,
        heat: me.player.heat,
        jailLeft: me.player.jailLeft,
        nextEnergyIn: me.player.nextEnergyIn,
      },
    };
  } catch (error) {
    return { ok: false, account: safeAccount, error: safeErrorSummary(error) };
  }
}

export async function runAllProfilesTick(settings, options = {}) {
  const opts = withDefaults(options);
  const accounts = opts.accounts ?? await listSessionAccounts();
  const now = Date.now();
  const settled = await Promise.allSettled(accounts.map(async (account) => {
    const enabled = accountAutomationEnabled(settings, account.id);
    if (!enabled) {
      opts.nextHeistAt?.delete(account.id);
      return {
        ok: true,
        enabled: false,
        account: publicAccount(account),
        reason: "disabled",
      };
    }
    if (!account.hasCookie) {
      return {
        ok: false,
        enabled: true,
        account: publicAccount(account),
        reason: "missing-cookie",
      };
    }
    return await runOneProfileTick(account, settings, opts, now);
  }));
  const results = settled.map((row, index) => row.status === "fulfilled"
    ? row.value
    : {
        ok: false,
        account: publicAccount(accounts[index]),
        error: safeErrorSummary(row.reason),
      });

  const okCount = results.filter((row) => row.ok).length;
  const failedCount = results.length - okCount;
  const enabledCount = results.filter((row) => row.enabled !== false).length;
  profileLog(opts.dryRun ? "profiles-tick-dry-run" : "profiles-tick-live", {
    accounts: results.length,
    enabled: enabledCount,
    ok: okCount,
    failed: failedCount,
  });

  for (const row of results) {
    profileLog(row.ok ? "profiles-account-ok" : "profiles-account-error", {
      accountId: row.account?.id,
      kind: row.account?.kind,
      enabled: row.enabled !== false,
      gangAccepted: row.gang?.accepted,
      heistChecked: row.heist?.checked,
      heistSkipped: row.heist?.reason,
      dailyChecked: row.daily?.checked,
      dailyStreak: row.daily?.streakClaimed || row.daily?.streakAttempted,
      dailyContracts: row.daily?.contractsClaimed ?? row.daily?.contractsFound,
      error: row.error?.category ?? row.reason,
      code: row.error?.code,
    });
  }

  return {
    ok: failedCount === 0,
    dryRun: opts.dryRun,
    accounts: results,
  };
}

async function runOneProfileTick(account, settings, options, now) {
  const result = {
    ok: true,
    enabled: true,
    account: publicAccount(account),
    gang: null,
    heist: null,
    daily: null,
    errors: [],
  };

  let api = null;
  try {
    const credential = await loadCredential(account, options);
    api = makeApi(credential, options);
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: safeErrorSummary(error),
    };
  }

  if (options.gang && settings.gang?.enabled !== false) {
    try {
      const gang = await acceptGangRequests(api, {
        dryRun: options.dryRun,
        max: settings.gang.max ?? Number.POSITIVE_INFINITY,
        minEarned: settings.gang.minEarned,
        notify: settings.gang.notify || options.notify,
      });
      result.gang = summarizeGang(gang);
    } catch (error) {
      result.ok = false;
      result.errors.push({ scope: "gang", ...safeErrorSummary(error) });
    }
  } else {
    result.gang = { checked: false, reason: "disabled" };
  }

  if (options.heist) {
    const nextHeistAt = options.nextHeistAt;
    const dueAt = nextHeistAt?.get(account.id) ?? 0;
    if (nextHeistAt && dueAt > now && !options.once) {
      result.heist = summarizeHeist(null, {
        checked: false,
        reason: "not-due",
        nextCheckSeconds: Math.ceil((dueAt - now) / 1000),
      });
    } else {
      try {
        const waitSeconds = await runJewelryHeistTick(api, {
          ...settings.jewelry,
          dryRun: options.dryRun,
          accountId: account.id,
          accountName: account.name,
          sleepFn: options.heistSleepFn,
          autoUpgradeEffectTypes: accountUpgradeEffectTypes(settings, account.id),
          autoUpgradeMaxPerTick: settings.upgrade.maxPerTick,
          autoUpgradeLootReserve: settings.upgrade.lootReserve,
        });
        const nextWait = Math.max(1, Math.min(Number(waitSeconds) || settings.jewelry.intervalSeconds, settings.jewelry.intervalSeconds));
        nextHeistAt?.set(account.id, Date.now() + nextWait * 1000);
        result.heist = summarizeHeist(nextWait);
      } catch (error) {
        result.ok = false;
        const summary = { scope: "heist", ...safeErrorSummary(error) };
        result.errors.push(summary);
        result.heist = { checked: false, reason: summary.category, code: summary.code };
      }
    }
  }

  if (options.daily && settings.daily?.enabled !== false) {
    try {
      const daily = await claimDailyRewards(api, {
        dryRun: options.dryRun,
        accountId: account.id,
        claimStreak: settings.daily?.claimStreak !== false,
        claimContracts: settings.daily?.claimContracts !== false,
        log: profileLog,
      });
      result.daily = summarizeDaily(daily);
    } catch (error) {
      result.ok = false;
      const summary = { scope: "daily", ...safeErrorSummary(error) };
      result.errors.push(summary);
      result.daily = { checked: false, reason: summary.category, code: summary.code };
    }
  }

  if (result.errors.length === 1) {
    result.error = result.errors[0];
  }
  return result;
}

async function loadCredential(account, options) {
  if (options.credentialLoader) return await options.credentialLoader(account);
  return await loadSessionAccountCredentials(account.id);
}

function makeApi(credential, options) {
  if (options.apiFactory) return options.apiFactory(credential);
  return new LootersApiClient({
    cookie: credential.cookie,
    proxyUrl: credential.proxyUrl,
    timeoutMs: options.timeoutMs,
  });
}

export async function watchAllProfiles(settings, options = {}) {
  const opts = withDefaults(options);
  const release = opts.lock ? await acquireLock("all-profiles-watch.lock", "All profiles watcher") : async () => {};
  const nextHeistAt = new Map();
  const intervalSeconds = Math.max(1, Number(opts.intervalSeconds) || DEFAULTS.intervalSeconds);

  try {
    profileLog(opts.dryRun ? "profiles-watch-started-dry-run" : "profiles-watch-started-live", {
      intervalSeconds,
      gang: opts.gang,
      heist: opts.heist,
      daily: opts.daily,
    });

    do {
      const currentSettings = opts.reloadSettings === false ? settings : await loadSettings();
      await runAllProfilesTick(currentSettings, {
        ...opts,
        intervalSeconds,
        nextHeistAt,
      });
      if (opts.once) break;
      await sleep(intervalSeconds * 1000);
    } while (true);
  } finally {
    await release();
  }
}
