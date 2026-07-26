import { LootersApiClient } from "./apiClient.js";
import { HEIST_TARGET_MODES, decideNextAction, planNextUpgrade, selectHeistTarget } from "./strategy.js";
import { acceptGangRequests } from "./gang.js";
import { loadActiveProfileProxyUrl, loadSessionCookie } from "./vault.js";
import { acquireLock } from "./lock.js";
import { claimDailyRewards } from "./daily.js";

const DEFAULTS = Object.freeze({
  heatCap: 45,
  bailCap: 100,
  targetMode: HEIST_TARGET_MODES.LOWEST_SAFE_CHANCE,
  minChance: 24,
  intervalSeconds: 15,
  dryRun: true,
  once: false,
  acceptRequests: false,
  acceptRequestsMax: Number.POSITIVE_INFINITY,
  acceptRequestsMinEarned: 0,
  autoClaimDaily: true,
  notify: false,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWorkerOptions(options = {}) {
  const opts = { ...DEFAULTS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }
  return opts;
}

function safeStatus(message, data = {}) {
  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);
  console.log(`[${new Date().toISOString()}] ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

export async function acquireWorkerLock() {
  return acquireLock("worker.lock", "Worker");
}

export async function readStatus(api) {
  const me = await api.get("me");
  if (!me?.player) {
    throw new Error("Session is not authenticated or player object is missing.");
  }
  const [contracts, factories] = await Promise.allSettled([
    api.get("contracts"),
    api.get("factories"),
  ]);
  return {
    player: me.player,
    contractsResponse: contracts.status === "fulfilled" ? contracts.value : null,
    contracts: contracts.status === "fulfilled" ? contracts.value?.contracts ?? [] : [],
    factories: factories.status === "fulfilled" ? factories.value?.factories ?? [] : [],
  };
}

export async function runWorker(options = {}) {
  const opts = normalizeWorkerOptions(options);
  const release = await acquireWorkerLock();
  try {
    const cookie = await loadSessionCookie();
    const api = new LootersApiClient({ cookie, proxyUrl: await loadActiveProfileProxyUrl() });
    safeStatus(opts.dryRun ? "worker-started-dry-run" : "worker-started-live", {
      heatCap: opts.heatCap,
      targetMode: opts.targetMode,
      minChance: opts.minChance,
    });

    do {
      const waitSeconds = await runWorkerTick(api, opts);
      if (opts.once) break;
      await sleep(Math.max(1, Math.min(waitSeconds, opts.intervalSeconds)) * 1000);
    } while (true);
  } finally {
    await release();
  }
}

export async function runWorkerTick(api, opts = {}) {
  const options = normalizeWorkerOptions(opts);
  const { player, contractsResponse, factories } = await readStatus(api);

  safeStatus("status", {
    loot: player.loot,
    energy: player.energy,
    heat: player.heat,
    jailLeft: player.jailLeft,
    factories: factories.length,
  });

  if (options.acceptRequests) {
    const accepted = await acceptGangRequests(api, {
      dryRun: options.dryRun,
      max: options.acceptRequestsMax,
      minEarned: options.acceptRequestsMinEarned,
      notify: options.notify,
    });
    safeStatus(options.dryRun ? "dry-gang-auto-accept" : "gang-auto-accept", {
      found: accepted.found,
      selected: accepted.selected,
    });
  }

  if (options.autoClaimDaily) {
    await claimDailyRewards(api, {
      dryRun: options.dryRun,
      player,
      contractsResponse,
      log: safeStatus,
    });
  }

  const action = decideNextAction(player, options);
  if (action.type === "bail") {
    safeStatus(options.dryRun ? "dry-bail" : "bail", { cost: action.cost });
    if (!options.dryRun) await api.post("bail", {});
    return options.intervalSeconds;
  }

  if (action.type === "upgrade") {
    const up = action.upgrade;
    safeStatus(options.dryRun ? "dry-upgrade" : "upgrade", {
      track: up.track,
      node: up.node,
      cost: up.cost,
      type: up.type,
      reason: up.reason,
    });
    if (!options.dryRun) await api.post("upgrade", { track: up.track, node: up.node });
    return options.intervalSeconds;
  }

  if (action.type === "heist") {
    safeStatus(options.dryRun ? "dry-heist" : "heist", {
      target: action.target.key,
      chance: action.target.chance,
      evPerEnergy: action.target.evPerEnergy.toFixed(2),
    });
    if (!options.dryRun) await api.post("heist", { target: action.target.key });
    return options.intervalSeconds;
  }

  safeStatus("wait", { reason: action.reason, seconds: action.seconds });
  return action.seconds ?? options.intervalSeconds;
}

export function previewPlan(player, opts = {}) {
  const options = normalizeWorkerOptions(opts);
  return {
    nextUpgrade: planNextUpgrade(player, { affordableOnly: false }),
    nextAffordableUpgrade: planNextUpgrade(player, { affordableOnly: true }),
    nextTarget: selectHeistTarget(player, options),
    nextAction: decideNextAction(player, options),
  };
}
