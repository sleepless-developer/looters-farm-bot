import {
  AUTO_UPGRADE_EFFECT_TYPES,
  BASE_COST_BY_NODE,
  COST_GROWTH,
  MAX_RANK,
  NODE_DEPENDENCIES,
  PRIORITY_UPGRADES,
  TRACK_NODES,
} from "./constants.js";

export const HEIST_TARGET_MODES = Object.freeze({
  STABLE_EV: "stable-ev",
  LOWEST_SAFE_CHANCE: "lowest-safe-chance",
});

export function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeHeistTargetMode(value, fallback = HEIST_TARGET_MODES.STABLE_EV) {
  const clean = String(value ?? "").trim().toLowerCase();
  return Object.values(HEIST_TARGET_MODES).includes(clean) ? clean : fallback;
}

export function rankOf(player, track, node) {
  return numeric(player?.perks?.[track]?.[String(node)] ?? player?.perks?.[track]?.[node], 0);
}

export function upgradeCost(node, currentRank) {
  return Math.round((BASE_COST_BY_NODE[node] ?? 200) * Math.pow(COST_GROWTH, currentRank));
}

export function isNodeEligible(player, track, node) {
  if (!TRACK_NODES[track]?.[node]) return false;
  if (rankOf(player, track, node) >= MAX_RANK) return false;
  return (NODE_DEPENDENCIES[node] ?? []).every((dep) => rankOf(player, track, dep) >= 1);
}

export function getEligibleUpgrades(player) {
  const rows = [];
  for (const [track, nodes] of Object.entries(TRACK_NODES)) {
    for (const nodeText of Object.keys(nodes)) {
      const node = Number(nodeText);
      if (!isNodeEligible(player, track, node)) continue;
      const currentRank = rankOf(player, track, node);
      const [type, value] = nodes[node];
      const cost = upgradeCost(node, currentRank);
      rows.push({
        track,
        node,
        currentRank,
        nextRank: currentRank + 1,
        type,
        value,
        cost,
        costPerEffect: value > 0 ? cost / value : null,
        costPerSuc: type === "suc" ? cost / value : null,
      });
    }
  }
  return rows;
}

export function planNextUpgrade(player, opts = {}) {
  const loot = numeric(player?.loot, 0);
  const affordableOnly = opts.affordableOnly ?? true;
  const eligible = getEligibleUpgrades(player);

  for (const wanted of PRIORITY_UPGRADES) {
    const currentRank = rankOf(player, wanted.track, wanted.node);
    if (currentRank >= wanted.desiredRank) continue;
    const candidate = eligible.find((row) => row.track === wanted.track && row.node === wanted.node);
    if (!candidate) continue;
    if (affordableOnly && candidate.cost > loot) continue;
    return { ...candidate, reason: `priority-${wanted.tier}` };
  }

  const fallback = eligible
    .filter((row) => row.type === "suc")
    .filter((row) => !affordableOnly || row.cost <= loot)
    .sort((a, b) => a.costPerSuc - b.costPerSuc || a.cost - b.cost)[0];

  return fallback ? { ...fallback, reason: "dynamic-cheapest-success" } : null;
}

export function normalizeUpgradeEffectTypes(value) {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value && typeof value === "object"
        ? Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([type]) => type)
        : [];
  const selected = new Set(requested.map((type) => String(type).trim().toLowerCase()));
  return AUTO_UPGRADE_EFFECT_TYPES.filter((type) => selected.has(type));
}

export function planCheapestSelectedUpgrade(player, opts = {}) {
  const loot = numeric(player?.loot, 0);
  const affordableOnly = opts.affordableOnly ?? true;
  const lootReserve = Math.max(0, numeric(opts.lootReserve, 0));
  const spendableLoot = Math.max(0, loot - lootReserve);
  const selectedTypes = normalizeUpgradeEffectTypes(opts.effectTypes ?? opts.types);
  if (selectedTypes.length === 0) return null;

  const typeOrder = new Map(AUTO_UPGRADE_EFFECT_TYPES.map((type, index) => [type, index]));
  const selected = new Set(selectedTypes);
  const upgrade = getEligibleUpgrades(player)
    .filter((row) => selected.has(row.type))
    .filter((row) => !affordableOnly || row.cost <= spendableLoot)
    .sort((a, b) => (
      a.cost - b.cost
      || (typeOrder.get(a.type) ?? 99) - (typeOrder.get(b.type) ?? 99)
      || a.track.localeCompare(b.track)
      || a.node - b.node
    ))[0];

  return upgrade
    ? {
        ...upgrade,
        selectedTypes,
        reason: selectedTypes.length === AUTO_UPGRADE_EFFECT_TYPES.length
          ? "cheapest-any-selected-effect"
          : "cheapest-selected-effect",
      }
    : null;
}

export function planCheapestSuccessUpgrade(player, opts = {}) {
  const upgrade = planCheapestSelectedUpgrade(player, {
    ...opts,
    effectTypes: ["suc"],
  });
  return upgrade ? { ...upgrade, reason: "cheapest-success" } : null;
}

export function targetEvPerEnergy(target) {
  const chance = numeric(target?.chance, 0) / 100;
  const avgPayout = (numeric(target?.min, 0) + numeric(target?.max, 0)) / 2;
  const energy = Math.max(1, numeric(target?.energy, 1));
  return (chance * avgPayout) / energy;
}

export function heistTargetSummary(target) {
  return {
    key: target.key,
    energy: numeric(target.energy, 1),
    chance: numeric(target.chance, 0),
    min: numeric(target.min, 0),
    max: numeric(target.max, 0),
    evPerEnergy: targetEvPerEnergy(target),
  };
}

export function heistCandidates(player, opts = {}) {
  const minChance = numeric(opts.minChance, 20);
  const energy = numeric(opts.maxEnergy, numeric(player?.energy, 0));
  const targets = Array.isArray(player?.targets) ? player.targets : [];
  return targets
    .filter((target) => numeric(target?.energy, 1) <= energy)
    .filter((target) => numeric(target?.chance, 0) >= minChance)
    .map(heistTargetSummary);
}

export function selectStableHeistTarget(player, opts = {}) {
  return heistCandidates(player, opts)
    .sort((a, b) => b.evPerEnergy - a.evPerEnergy || a.energy - b.energy)[0] ?? null;
}

export function selectLowestSafeChanceHeistTarget(player, opts = {}) {
  return heistCandidates(player, opts)
    .sort((a, b) => (
      a.chance - b.chance
      || b.evPerEnergy - a.evPerEnergy
      || b.energy - a.energy
      || String(a.key).localeCompare(String(b.key))
    ))[0] ?? null;
}

export function selectHeistTarget(player, opts = {}) {
  const targetMode = normalizeHeistTargetMode(opts.targetMode ?? opts.heistTargetMode);
  if (targetMode === HEIST_TARGET_MODES.LOWEST_SAFE_CHANCE) {
    return selectLowestSafeChanceHeistTarget(player, opts);
  }
  return selectStableHeistTarget(player, opts);
}

export function decideNextAction(player, opts = {}) {
  const heatCap = numeric(opts.heatCap, 45);
  const bailCap = numeric(opts.bailCap, 100);
  const minChance = numeric(opts.minChance, 20);
  const targetMode = normalizeHeistTargetMode(opts.targetMode ?? opts.heistTargetMode);

  const loot = numeric(player?.loot, 0);
  const energy = numeric(player?.energy, 0);
  const heat = numeric(player?.heat, 0);
  const jailLeft = numeric(player?.jailLeft, 0);
  const bailCost = numeric(player?.bailCost, Number.POSITIVE_INFINITY);

  if (jailLeft > 0) {
    if (bailCost <= bailCap && bailCost <= loot) {
      return { type: "bail", cost: bailCost, reason: "jailed-bail-under-cap" };
    }
    return { type: "wait", seconds: jailLeft, reason: "jailed" };
  }

  const upgrade = planNextUpgrade(player, { affordableOnly: true });
  if (upgrade) {
    return { type: "upgrade", upgrade, reason: upgrade.reason };
  }

  if (heat >= heatCap) {
    return { type: "wait", seconds: 60, reason: "heat-cap" };
  }

  if (energy <= 0) {
    return { type: "wait", seconds: Math.max(5, numeric(player?.nextEnergyIn, 60)), reason: "no-energy" };
  }

  const target = selectHeistTarget(player, { minChance, targetMode });
  if (!target) {
    return { type: "wait", seconds: Math.max(5, numeric(player?.nextEnergyIn, 60)), reason: "no-safe-target" };
  }

  return { type: "heist", target, reason: targetMode };
}
