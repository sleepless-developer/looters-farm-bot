import {
  HEIST_TARGET_MODES,
  heistTargetSummary,
  normalizeHeistTargetMode,
  normalizeUpgradeEffectTypes,
  numeric,
  planCheapestSelectedUpgrade,
  rankOf,
  selectHeistTarget,
} from "./strategy.js";
import { acquireLock } from "./lock.js";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir } from "./vault.js";
import { claimDailyRewards } from "./daily.js";

export const SCHEDULED_TARGET_MODES = Object.freeze({
  FIXED: "fixed",
  STABLE_EV: HEIST_TARGET_MODES.STABLE_EV,
  LOWEST_SAFE_CHANCE: HEIST_TARGET_MODES.LOWEST_SAFE_CHANCE,
});

export const JEWELRY_DEFAULTS = Object.freeze({
  dryRun: true,
  once: false,
  intervalSeconds: 660,
  runIntervalSeconds: 3,
  energyBudget: 10,
  requireFullBudget: false,
  heatCap: 45,
  targetMode: SCHEDULED_TARGET_MODES.LOWEST_SAFE_CHANCE,
  minChance: 24,
  targetKey: "jewelry",
  autoUpgradeEffectTypes: [],
  autoUpgradeSuccess: false,
  autoUpgradeMaxPerTick: 10,
  autoUpgradeLootReserve: 0,
  autoClaimDaily: false,
  lock: true,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJewelryDefaults(options = {}) {
  const opts = { ...JEWELRY_DEFAULTS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) opts[key] = value;
  }
  return opts;
}

function jewelryLog(message, data = {}) {
  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);
  const line = `[${new Date().toISOString()}] ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`;
  console.log(line);
  writeRuntimeLog(line).catch(() => {});
}

async function writeRuntimeLog(line) {
  await mkdir(appDataDir(), { recursive: true });
  await appendFile(join(appDataDir(), "jewelry-runtime.safe.log"), `${line}\n`, "utf8");
}

export function findHeistTarget(player, targetKey = JEWELRY_DEFAULTS.targetKey) {
  const wanted = String(targetKey).toLowerCase();
  const aliases = wanted === "jewerly" ? new Set(["jewerly", "jewelry"]) : new Set([wanted]);
  return (Array.isArray(player?.targets) ? player.targets : [])
    .find((target) => aliases.has(String(target?.key ?? "").toLowerCase())) ?? null;
}

export function normalizeScheduledTargetMode(value, fallback = JEWELRY_DEFAULTS.targetMode) {
  const clean = String(value ?? "").trim().toLowerCase();
  return Object.values(SCHEDULED_TARGET_MODES).includes(clean) ? clean : fallback;
}

export function selectScheduledHeistTarget(player, options = {}) {
  const opts = withJewelryDefaults(options);
  const targetMode = normalizeScheduledTargetMode(opts.targetMode);
  if (targetMode === SCHEDULED_TARGET_MODES.FIXED) {
    const fixed = findHeistTarget(player, opts.targetKey);
    return fixed ? heistTargetSummary(fixed) : null;
  }

  return selectHeistTarget(player, {
    targetMode: normalizeHeistTargetMode(targetMode),
    minChance: opts.minChance,
    maxEnergy: opts.energyBudget,
  });
}

export function planJewelryHeistBatch(player, options = {}) {
  const opts = withJewelryDefaults(options);
  const targetMode = normalizeScheduledTargetMode(opts.targetMode);
  const target = selectScheduledHeistTarget(player, opts);
  const energy = numeric(player?.energy, 0);
  const heat = numeric(player?.heat, 0);
  const jailLeft = numeric(player?.jailLeft, 0);

  if (jailLeft > 0) {
    return { type: "wait", reason: "jailed", seconds: Math.max(5, jailLeft) };
  }
  if (heat >= numeric(opts.heatCap, JEWELRY_DEFAULTS.heatCap)) {
    return { type: "wait", reason: "heat-cap", seconds: opts.intervalSeconds };
  }
  if (!target) {
    return {
      type: "wait",
      reason: targetMode === SCHEDULED_TARGET_MODES.FIXED ? "target-missing" : "no-safe-target",
      seconds: opts.intervalSeconds,
      targetMode,
      minChance: numeric(opts.minChance, JEWELRY_DEFAULTS.minChance),
    };
  }

  const targetEnergy = Math.max(1, numeric(target.energy, 1));
  const energyBudget = Math.max(targetEnergy, numeric(opts.energyBudget, JEWELRY_DEFAULTS.energyBudget));
  if (energy < targetEnergy) {
    return {
      type: "wait",
      reason: "not-enough-energy",
      seconds: Math.max(5, numeric(player?.nextEnergyIn, opts.intervalSeconds)),
      energy,
      requiredEnergy: targetEnergy,
      target: target.key,
      targetMode,
      minChance: numeric(opts.minChance, JEWELRY_DEFAULTS.minChance),
      chance: numeric(target.chance, 0),
    };
  }

  if (opts.requireFullBudget && energy < energyBudget) {
    return {
      type: "wait",
      reason: "not-enough-budget-energy",
      seconds: Math.max(5, numeric(player?.nextEnergyIn, opts.intervalSeconds)),
      energy,
      requiredEnergy: energyBudget,
      target: target.key,
      targetMode,
      minChance: numeric(opts.minChance, JEWELRY_DEFAULTS.minChance),
      chance: numeric(target.chance, 0),
    };
  }

  const spendableEnergy = Math.min(energy, energyBudget);
  const runs = Math.max(1, Math.floor(spendableEnergy / targetEnergy));
  return {
    type: "heist-batch",
    target: target.key,
    runs,
    targetEnergy,
    plannedEnergy: runs * targetEnergy,
    chance: numeric(target.chance, 0),
    targetMode,
    minChance: numeric(opts.minChance, JEWELRY_DEFAULTS.minChance),
    evPerEnergy: Number(target.evPerEnergy ?? 0),
  };
}

export function planAutoSuccessUpgrade(player, options = {}) {
  return planAutoUpgrade(player, {
    ...options,
    autoUpgradeEffectTypes: options.autoUpgradeEffectTypes
      ?? (options.autoUpgradeSuccess ? ["suc"] : []),
  });
}

export function planAutoUpgrade(player, options = {}) {
  const opts = withJewelryDefaults(options);
  const effectTypes = selectedAutoUpgradeEffectTypes(opts);
  if (effectTypes.length === 0) {
    return { type: "disabled", reason: "auto-upgrade-disabled" };
  }

  const upgrade = planCheapestSelectedUpgrade(player, {
    affordableOnly: true,
    lootReserve: opts.autoUpgradeLootReserve,
    effectTypes,
  });

  if (!upgrade) {
    return {
      type: "wait",
      reason: "no-affordable-selected-upgrade",
      effectTypes,
      loot: numeric(player?.loot, 0),
      lootReserve: numeric(opts.autoUpgradeLootReserve, 0),
    };
  }

  return { type: "upgrade", effectTypes, upgrade };
}

function selectedAutoUpgradeEffectTypes(options = {}) {
  const selected = normalizeUpgradeEffectTypes(options.autoUpgradeEffectTypes);
  if (selected.length > 0) return selected;
  return options.autoUpgradeSuccess ? ["suc"] : [];
}

function hasAutoUpgrade(options = {}) {
  return selectedAutoUpgradeEffectTypes(options).length > 0;
}

async function runAutoUpgradeSweep(api, player, options = {}, alreadyDone = 0) {
  const opts = withJewelryDefaults(options);
  const maxPerTick = Math.max(1, numeric(opts.autoUpgradeMaxPerTick, JEWELRY_DEFAULTS.autoUpgradeMaxPerTick));
  if (!hasAutoUpgrade(opts) || alreadyDone >= maxPerTick) {
    return { count: 0, player, limitReached: alreadyDone >= maxPerTick };
  }

  let currentPlayer = player;
  let count = 0;
  while (alreadyDone + count < maxPerTick) {
    const plan = planAutoUpgrade(currentPlayer, opts);
    if (plan.type !== "upgrade") {
      if (count === 0 && plan.type === "wait") {
        jewelryLog("auto-upgrade-wait", {
          accountId: opts.accountId,
          reason: plan.reason,
          effects: plan.effectTypes?.join(","),
          loot: plan.loot,
          lootReserve: plan.lootReserve,
        });
      }
      break;
    }

    const up = plan.upgrade;
    jewelryLog(opts.dryRun ? "dry-auto-upgrade" : "auto-upgrade", {
      accountId: opts.accountId,
      track: up.track,
      node: up.node,
      cost: up.cost,
      effect: up.type,
      value: up.value,
      costPerEffect: up.costPerEffect?.toFixed?.(2) ?? up.costPerEffect,
      reason: up.reason,
    });
    count += 1;

    if (opts.dryRun) break;

    const previousRank = rankOf(currentPlayer, up.track, up.node);
    await api.post("upgrade", { track: up.track, node: up.node });
    const nextMe = await api.get("me");
    if (!nextMe?.player) throw new Error("Session is not authenticated or player object is missing after upgrade.");
    currentPlayer = nextMe.player;
    if (rankOf(currentPlayer, up.track, up.node) <= previousRank) {
      jewelryLog("auto-upgrade-state-stale", { accountId: opts.accountId, track: up.track, node: up.node });
      break;
    }
  }

  return {
    count,
    player: currentPlayer,
    limitReached: alreadyDone + count >= maxPerTick,
  };
}

export async function runJewelryHeistTick(api, options = {}) {
  const opts = withJewelryDefaults(options);
  const me = await api.get("me");
  if (!me?.player) throw new Error("Session is not authenticated or player object is missing.");
  let player = me.player;
  let upgradesDone = 0;

  const beforeUpgrade = await runAutoUpgradeSweep(api, player, opts, upgradesDone);
  upgradesDone += beforeUpgrade.count;
  player = beforeUpgrade.player;

  const plan = planJewelryHeistBatch(player, opts);

  if (plan.type !== "heist-batch") {
    jewelryLog("jewelry-heist-wait", {
      accountId: opts.accountId,
      reason: plan.reason,
      seconds: plan.seconds,
      energy: plan.energy,
      requiredEnergy: plan.requiredEnergy,
    });
    if (opts.autoClaimDaily) {
      await claimDailyRewards(api, {
        dryRun: opts.dryRun,
        accountId: opts.accountId,
        player,
        log: jewelryLog,
      });
    }
    return plan.seconds ?? opts.intervalSeconds;
  }

  jewelryLog(opts.dryRun ? "dry-jewelry-heist-batch" : "jewelry-heist-batch", {
    accountId: opts.accountId,
    target: plan.target,
    runs: plan.runs,
    plannedEnergy: plan.plannedEnergy,
    chance: plan.chance,
    targetMode: plan.targetMode,
    minChance: plan.minChance,
  });

  for (let i = 0; i < plan.runs; i += 1) {
    if (opts.dryRun) {
      jewelryLog("dry-jewelry-heist", { accountId: opts.accountId, target: plan.target, index: i + 1, total: plan.runs });
      continue;
    }

    await api.post("heist", { target: plan.target });
    jewelryLog("jewelry-heist", { accountId: opts.accountId, target: plan.target, index: i + 1, total: plan.runs });

    if (i < plan.runs - 1) {
      const runIntervalSeconds = Math.max(0, numeric(opts.runIntervalSeconds, JEWELRY_DEFAULTS.runIntervalSeconds));
      if (runIntervalSeconds > 0) {
        await (opts.sleepFn ?? sleep)(runIntervalSeconds * 1000);
      }
      const nextMe = await api.get("me");
      const nextPlan = planJewelryHeistBatch(nextMe.player, {
        ...opts,
        targetMode: SCHEDULED_TARGET_MODES.FIXED,
        targetKey: plan.target,
        energyBudget: plan.targetEnergy,
      });
      if (nextPlan.type !== "heist-batch") {
        jewelryLog("jewelry-heist-batch-stop", { accountId: opts.accountId, reason: nextPlan.reason, completed: i + 1, planned: plan.runs });
        break;
      }
    }
  }

  let latestPlayer = player;
  if (!opts.dryRun && (hasAutoUpgrade(opts) || opts.autoClaimDaily)) {
    const afterMe = await api.get("me");
    if (!afterMe?.player) throw new Error("Session is not authenticated or player object is missing after heists.");
    latestPlayer = afterMe.player;
  }

  if (!opts.dryRun && hasAutoUpgrade(opts) && upgradesDone < Math.max(1, numeric(opts.autoUpgradeMaxPerTick, JEWELRY_DEFAULTS.autoUpgradeMaxPerTick))) {
    const afterMe = { player: latestPlayer };
    if (!afterMe?.player) throw new Error("Session is not authenticated or player object is missing after heists.");
    const afterUpgrade = await runAutoUpgradeSweep(api, afterMe.player, opts, upgradesDone);
    upgradesDone += afterUpgrade.count;
    latestPlayer = afterUpgrade.player;
    if (afterUpgrade.limitReached) {
      jewelryLog("auto-upgrade-limit", { accountId: opts.accountId, maxPerTick: opts.autoUpgradeMaxPerTick, done: upgradesDone });
    }
  }

  if (opts.autoClaimDaily) {
    await claimDailyRewards(api, {
      dryRun: opts.dryRun,
      accountId: opts.accountId,
      player: latestPlayer,
      log: jewelryLog,
    });
  }

  return opts.intervalSeconds;
}

export async function watchJewelryHeists(api, options = {}) {
  const opts = withJewelryDefaults(options);
  const intervalSeconds = Math.max(1, numeric(opts.intervalSeconds, JEWELRY_DEFAULTS.intervalSeconds));
  const release = opts.lock ? await acquireLock("jewelry-heist-watch.lock", "Jewelry heist watcher") : async () => {};

  try {
    jewelryLog(opts.dryRun ? "jewelry-watch-started-dry-run" : "jewelry-watch-started-live", {
      accountId: opts.accountId,
      intervalSeconds,
      energyBudget: opts.energyBudget,
      target: opts.targetKey,
      targetMode: opts.targetMode,
      minChance: opts.minChance,
      heatCap: opts.heatCap,
      autoUpgradeEffects: selectedAutoUpgradeEffectTypes(opts).join(",") || "none",
      autoClaimDaily: opts.autoClaimDaily,
    });

    do {
      let waitSeconds = intervalSeconds;
      try {
        waitSeconds = await runJewelryHeistTick(api, { ...opts, intervalSeconds });
      } catch (error) {
        jewelryLog("jewelry-watch-error", { message: error.message });
      }

      if (opts.once) break;
      await sleep(Math.max(1, Math.min(waitSeconds, intervalSeconds)) * 1000);
    } while (true);
  } finally {
    await release();
  }
}
