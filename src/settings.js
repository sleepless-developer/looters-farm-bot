import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AUTO_UPGRADE_EFFECT_TYPES } from "./constants.js";
import { appDataDir } from "./vault.js";

export const DEFAULT_SETTINGS = Object.freeze({
  gang: {
    enabled: true,
    intervalSeconds: 5,
    notify: true,
    minEarned: 0,
    max: null,
  },
  profiles: {
    intervalSeconds: 3,
  },
  jewelry: {
    intervalSeconds: 660,
    runIntervalSeconds: 3,
    energyBudget: 10,
    heatCap: 45,
    requireFullBudget: true,
    targetMode: "lowest-safe-chance",
    minChance: 24,
    targetKey: "jewelry",
  },
  upgrade: {
    enabled: false,
    mode: "cheapest-success",
    maxPerTick: 10,
    lootReserve: 0,
  },
  daily: {
    enabled: true,
    requireZeroEnergy: true,
    claimStreak: true,
    claimContracts: true,
  },
  automationByAccount: {},
  upgradeByAccount: {},
});

export async function settingsPath() {
  await mkdir(appDataDir(), { recursive: true });
  return join(appDataDir(), "settings.json");
}

export async function lastLaunchSettingsPath() {
  await mkdir(appDataDir(), { recursive: true });
  return join(appDataDir(), "last-launch-settings.json");
}

export function normalizeSettings(input = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const gang = input.gang ?? {};
  const profiles = input.profiles ?? {};
  const jewelry = input.jewelry ?? {};
  const upgrade = input.upgrade ?? {};
  const daily = input.daily ?? {};
  const automationByAccount = input.automationByAccount ?? {};
  const upgradeByAccount = input.upgradeByAccount ?? {};

  settings.gang.enabled = Boolean(gang.enabled ?? DEFAULT_SETTINGS.gang.enabled);
  settings.gang.intervalSeconds = positiveInt(gang.intervalSeconds, DEFAULT_SETTINGS.gang.intervalSeconds);
  settings.gang.notify = Boolean(gang.notify ?? DEFAULT_SETTINGS.gang.notify);
  settings.gang.minEarned = nonNegativeNumber(gang.minEarned, DEFAULT_SETTINGS.gang.minEarned);
  settings.gang.max = gang.max == null || gang.max === ""
    ? null
    : positiveInt(gang.max, Number.POSITIVE_INFINITY);

  settings.profiles.intervalSeconds = positiveInt(profiles.intervalSeconds, DEFAULT_SETTINGS.profiles.intervalSeconds);
  settings.jewelry.intervalSeconds = positiveInt(jewelry.intervalSeconds, DEFAULT_SETTINGS.jewelry.intervalSeconds);
  settings.jewelry.runIntervalSeconds = positiveInt(jewelry.runIntervalSeconds, DEFAULT_SETTINGS.jewelry.runIntervalSeconds);
  settings.jewelry.energyBudget = positiveInt(jewelry.energyBudget, DEFAULT_SETTINGS.jewelry.energyBudget);
  settings.jewelry.heatCap = nonNegativeNumber(jewelry.heatCap, DEFAULT_SETTINGS.jewelry.heatCap);
  settings.jewelry.requireFullBudget = Boolean(jewelry.requireFullBudget ?? DEFAULT_SETTINGS.jewelry.requireFullBudget);
  settings.jewelry.targetMode = normalizeTargetMode(jewelry.targetMode, DEFAULT_SETTINGS.jewelry.targetMode);
  settings.jewelry.minChance = boundedNumber(jewelry.minChance, DEFAULT_SETTINGS.jewelry.minChance, 0, 100);
  settings.jewelry.targetKey = safeTargetKey(jewelry.targetKey, DEFAULT_SETTINGS.jewelry.targetKey);

  settings.upgrade.enabled = Boolean(upgrade.enabled ?? DEFAULT_SETTINGS.upgrade.enabled);
  settings.upgrade.mode = upgrade.mode === "cheapest-success" ? "cheapest-success" : DEFAULT_SETTINGS.upgrade.mode;
  settings.upgrade.maxPerTick = positiveInt(upgrade.maxPerTick, DEFAULT_SETTINGS.upgrade.maxPerTick);
  settings.upgrade.lootReserve = nonNegativeNumber(upgrade.lootReserve, DEFAULT_SETTINGS.upgrade.lootReserve);
  settings.daily.enabled = Boolean(daily.enabled ?? DEFAULT_SETTINGS.daily.enabled);
  settings.daily.requireZeroEnergy = true;
  settings.daily.claimStreak = Boolean(daily.claimStreak ?? DEFAULT_SETTINGS.daily.claimStreak);
  settings.daily.claimContracts = Boolean(daily.claimContracts ?? DEFAULT_SETTINGS.daily.claimContracts);
  settings.automationByAccount = normalizeAccountBooleanMap(automationByAccount);
  settings.upgradeByAccount = normalizeUpgradeByAccount(upgradeByAccount);

  return settings;
}

export function accountAutomationEnabled(settings, accountId = "main") {
  const id = safeAccountId(accountId) || "main";
  const perAccount = settings?.automationByAccount?.[id]?.enabled;
  if (typeof perAccount === "boolean") return perAccount;
  return true;
}

export function setAccountAutomationEnabled(settings, accountId, enabled) {
  const normalized = normalizeSettings(settings);
  const id = safeAccountId(accountId);
  if (!id) throw new Error("Invalid account id for automation settings.");
  normalized.automationByAccount[id] = { enabled: Boolean(enabled) };
  return normalized;
}

export function setAccountsAutomationEnabled(settings, accountIds, enabled) {
  let normalized = normalizeSettings(settings);
  for (const accountId of accountIds ?? []) {
    normalized = setAccountAutomationEnabled(normalized, accountId, enabled);
  }
  return normalized;
}

export function accountUpgradeEnabled(settings, accountId = "main") {
  return accountUpgradeEffectTypes(settings, accountId).length > 0;
}

export function accountUpgradeEffectTypes(settings, accountId = "main") {
  const selection = accountUpgradeSelection(settings, accountId);
  return AUTO_UPGRADE_EFFECT_TYPES.filter((type) => selection[type]);
}

export function accountUpgradeSelection(settings, accountId = "main") {
  const id = safeAccountId(accountId) || "main";
  const perAccount = settings?.upgradeByAccount?.[id];
  if (perAccount !== undefined) return normalizeUpgradeSelection(perAccount);
  return normalizeUpgradeSelection(Boolean(settings?.upgrade?.enabled ?? DEFAULT_SETTINGS.upgrade.enabled));
}

export function setAccountUpgradeEnabled(settings, accountId, enabled) {
  const normalized = normalizeSettings(settings);
  const id = safeAccountId(accountId);
  if (!id) throw new Error("Invalid account id for upgrade settings.");
  normalized.upgradeByAccount[id] = normalizeUpgradeSelection(Boolean(enabled));
  return normalized;
}

export function setAccountUpgradeEffectEnabled(settings, accountId, effectType, enabled) {
  const normalized = normalizeSettings(settings);
  const id = safeAccountId(accountId);
  const type = String(effectType ?? "").trim().toLowerCase();
  if (!id) throw new Error("Invalid account id for upgrade settings.");
  if (!AUTO_UPGRADE_EFFECT_TYPES.includes(type)) throw new Error("Invalid auto-upgrade effect type.");
  normalized.upgradeByAccount[id] = {
    ...accountUpgradeSelection(normalized, id),
    [type]: Boolean(enabled),
  };
  return normalized;
}

export async function loadSettings() {
  try {
    const raw = await readFile(await settingsPath(), "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    const lastLaunch = await loadLastLaunchSettings();
    if (lastLaunch) return lastLaunch;
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await writeFile(await settingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export async function loadLastLaunchSettings() {
  try {
    const raw = await readFile(await lastLaunchSettingsPath(), "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveLastLaunchSettings(settings) {
  const normalized = normalizeSettings(settings);
  await writeFile(await lastLaunchSettingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function normalizeTargetMode(value, fallback) {
  const clean = String(value ?? "").trim().toLowerCase();
  return ["lowest-safe-chance", "stable-ev"].includes(clean) ? clean : fallback;
}

function safeTargetKey(value, fallback) {
  const clean = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/i.test(clean) ? clean : fallback;
}

function normalizeUpgradeByAccount(input = {}) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    const id = safeAccountId(key);
    if (!id) continue;
    out[id] = normalizeUpgradeSelection(value);
  }
  return out;
}

function normalizeUpgradeSelection(value) {
  const isObject = value && typeof value === "object" && !Array.isArray(value);
  const hasExplicitType = isObject
    && AUTO_UPGRADE_EFFECT_TYPES.some((type) => Object.prototype.hasOwnProperty.call(value, type));
  const legacyEnabled = Boolean(isObject ? value.enabled : value);
  return Object.fromEntries(AUTO_UPGRADE_EFFECT_TYPES.map((type) => [
    type,
    hasExplicitType ? Boolean(value[type]) : type === "suc" && legacyEnabled,
  ]));
}

function normalizeAccountBooleanMap(input = {}) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    const id = safeAccountId(key);
    if (!id) continue;
    out[id] = {
      enabled: Boolean(typeof value === "object" && value !== null ? value.enabled : value),
    };
  }
  return out;
}

function safeAccountId(value) {
  const clean = String(value ?? "").trim();
  return clean === "main" || /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(clean) ? clean : "";
}
