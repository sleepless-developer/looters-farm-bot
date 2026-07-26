import test from "node:test";
import assert from "node:assert/strict";
import {
  accountAutomationEnabled,
  accountUpgradeEffectTypes,
  accountUpgradeEnabled,
  accountUpgradeSelection,
  DEFAULT_SETTINGS,
  normalizeSettings,
  setAccountAutomationEnabled,
  setAccountsAutomationEnabled,
  setAccountUpgradeEffectEnabled,
  setAccountUpgradeEnabled,
} from "../src/settings.js";
import { buildWatcherArgs } from "../src/processManager.js";

test("settings normalize invalid values back to safe defaults", () => {
  const settings = normalizeSettings({
    gang: { intervalSeconds: -1, notify: false, minEarned: -10, max: "" },
    profiles: { intervalSeconds: 0 },
    jewelry: { intervalSeconds: 0, runIntervalSeconds: 0, energyBudget: 0, heatCap: -1, requireFullBudget: false },
    upgrade: { enabled: true, mode: "unknown", maxPerTick: 0, lootReserve: -1 },
    daily: { enabled: false, requireZeroEnergy: false, claimStreak: false, claimContracts: false },
    automationByAccount: { main: false, alt_1: { enabled: true }, "bad space": true },
    upgradeByAccount: { main: true, "bad space": true, alt_1: { enabled: false } },
  });
  assert.equal(settings.gang.enabled, true);
  assert.equal(settings.gang.intervalSeconds, DEFAULT_SETTINGS.gang.intervalSeconds);
  assert.equal(settings.gang.notify, false);
  assert.equal(settings.gang.minEarned, DEFAULT_SETTINGS.gang.minEarned);
  assert.equal(settings.gang.max, null);
  assert.equal(settings.profiles.intervalSeconds, 3);
  assert.equal(settings.jewelry.intervalSeconds, DEFAULT_SETTINGS.jewelry.intervalSeconds);
  assert.equal(settings.jewelry.runIntervalSeconds, 3);
  assert.equal(settings.jewelry.energyBudget, DEFAULT_SETTINGS.jewelry.energyBudget);
  assert.equal(settings.jewelry.heatCap, DEFAULT_SETTINGS.jewelry.heatCap);
  assert.equal(settings.jewelry.requireFullBudget, false);
  assert.equal(settings.jewelry.targetMode, DEFAULT_SETTINGS.jewelry.targetMode);
  assert.equal(settings.jewelry.minChance, DEFAULT_SETTINGS.jewelry.minChance);
  assert.equal(settings.jewelry.targetKey, DEFAULT_SETTINGS.jewelry.targetKey);
  assert.equal(settings.upgrade.enabled, true);
  assert.equal(settings.upgrade.mode, "cheapest-success");
  assert.equal(settings.upgrade.maxPerTick, DEFAULT_SETTINGS.upgrade.maxPerTick);
  assert.equal(settings.upgrade.lootReserve, DEFAULT_SETTINGS.upgrade.lootReserve);
  assert.equal(settings.daily.enabled, false);
  assert.equal(settings.daily.requireZeroEnergy, true);
  assert.equal(settings.daily.claimStreak, false);
  assert.equal(settings.daily.claimContracts, false);
  assert.equal(settings.automationByAccount.main.enabled, false);
  assert.equal(settings.automationByAccount.alt_1.enabled, true);
  assert.equal(settings.automationByAccount["bad space"], undefined);
  assert.deepEqual(settings.upgradeByAccount.main, { suc: true, heat: false, pay: false, regen: false });
  assert.deepEqual(settings.upgradeByAccount.alt_1, { suc: false, heat: false, pay: false, regen: false });
  assert.equal(settings.upgradeByAccount["bad space"], undefined);
});

test("gang module enable state is persisted independently from watcher timing", () => {
  assert.equal(normalizeSettings({ gang: { enabled: false } }).gang.enabled, false);
  assert.equal(normalizeSettings({ gang: {} }).gang.enabled, true);
});

test("legacy success toggle migrates and upgrade effects remain independent per account", () => {
  let settings = normalizeSettings({
    upgradeByAccount: {
      main: { enabled: true },
      alt_1: { suc: false, heat: true, pay: true, regen: false },
    },
  });

  assert.deepEqual(accountUpgradeEffectTypes(settings, "main"), ["suc"]);
  assert.deepEqual(accountUpgradeEffectTypes(settings, "alt_1"), ["heat", "pay"]);

  settings = setAccountUpgradeEffectEnabled(settings, "alt_1", "regen", true);
  settings = setAccountUpgradeEffectEnabled(settings, "alt_1", "heat", false);
  assert.deepEqual(accountUpgradeSelection(settings, "alt_1"), {
    suc: false,
    heat: false,
    pay: true,
    regen: true,
  });
  assert.deepEqual(accountUpgradeEffectTypes(settings, "alt_1"), ["pay", "regen"]);
});

test("account autopilot selection is independent and defaults enabled", () => {
  let settings = normalizeSettings({});
  assert.equal(accountAutomationEnabled(settings, "main"), true);
  assert.equal(accountAutomationEnabled(settings, "alt_1"), true);

  settings = setAccountAutomationEnabled(settings, "main", false);
  assert.equal(accountAutomationEnabled(settings, "main"), false);
  assert.equal(accountAutomationEnabled(settings, "alt_1"), true);

  settings = setAccountsAutomationEnabled(settings, ["main", "alt_1"], true);
  assert.equal(accountAutomationEnabled(settings, "main"), true);
  assert.equal(accountAutomationEnabled(settings, "alt_1"), true);
});

test("gang watcher args are built from saved settings without secrets", () => {
  const settings = normalizeSettings({
    gang: { intervalSeconds: 7, notify: true, minEarned: 100, max: 3 },
  });
  assert.deepEqual(buildWatcherArgs("gang", settings), [
    "src/cli.js",
    "gang",
    "watch",
    "--live",
    "--interval",
    "7",
    "--notify",
    "--min-earned",
    "100",
    "--max",
    "3",
  ]);
});

test("jewelry watcher args support full-budget energy threshold mode", () => {
  const settings = normalizeSettings({
    jewelry: { intervalSeconds: 660, energyBudget: 10, heatCap: 45, requireFullBudget: true },
  });
  assert.deepEqual(buildWatcherArgs("jewelry", settings), [
    "src/cli.js",
    "heist",
    "jewelry-watch",
    "--live",
    "--interval",
    "660",
    "--run-interval",
    "3",
    "--energy",
    "10",
    "--heat-cap",
    "45",
    "--target-mode",
    "lowest-safe-chance",
    "--min-chance",
    "24",
    "--require-full-budget",
    "--auto-claim-daily",
  ]);
});

test("jewelry watcher args can enable cheapest success auto upgrade", () => {
  const settings = normalizeSettings({
    jewelry: { intervalSeconds: 660, energyBudget: 10, heatCap: 45, requireFullBudget: true },
    upgrade: { enabled: true, mode: "cheapest-success", maxPerTick: 10, lootReserve: 0 },
  });

  assert.deepEqual(buildWatcherArgs("jewelry", settings), [
    "src/cli.js",
    "heist",
    "jewelry-watch",
    "--live",
    "--interval",
    "660",
    "--run-interval",
    "3",
    "--energy",
    "10",
    "--heat-cap",
    "45",
    "--target-mode",
    "lowest-safe-chance",
    "--min-chance",
    "24",
    "--require-full-budget",
    "--auto-claim-daily",
    "--auto-upgrade-types",
    "suc",
    "--auto-upgrade-max",
    "10",
    "--auto-upgrade-reserve",
    "0",
  ]);
});

test("jewelry watcher args use account-specific cheapest success toggle", () => {
  let settings = normalizeSettings({
    jewelry: { intervalSeconds: 660, energyBudget: 10, heatCap: 45, requireFullBudget: true },
    upgrade: { enabled: false, mode: "cheapest-success", maxPerTick: 10, lootReserve: 0 },
  });
  settings = setAccountUpgradeEnabled(settings, "main", false);
  settings = setAccountUpgradeEnabled(settings, "alt_1", true);

  assert.equal(accountUpgradeEnabled(settings, "main"), false);
  assert.equal(accountUpgradeEnabled(settings, "alt_1"), true);
  assert.equal(buildWatcherArgs("jewelry", settings, { accountId: "main" }).includes("--auto-upgrade-types"), false);
  assert.deepEqual(
    buildWatcherArgs("jewelry", settings, { accountId: "alt_1" }).slice(-6),
    ["--auto-upgrade-types", "suc", "--auto-upgrade-max", "10", "--auto-upgrade-reserve", "0"],
  );
});

test("saved fixed target mode is migrated back to dynamic lowest-safe-chance", () => {
  const settings = normalizeSettings({
    jewelry: {
      intervalSeconds: 30,
      energyBudget: 5,
      heatCap: 40,
      requireFullBudget: false,
      targetMode: "fixed",
      minChance: 24,
      targetKey: "reserve",
    },
  });

  assert.deepEqual(buildWatcherArgs("jewelry", settings), [
    "src/cli.js",
    "heist",
    "jewelry-watch",
    "--live",
    "--interval",
    "30",
    "--run-interval",
    "3",
    "--energy",
    "5",
    "--heat-cap",
    "40",
    "--target-mode",
    "lowest-safe-chance",
    "--min-chance",
    "24",
    "--auto-claim-daily",
  ]);
});

test("profiles watcher uses its independent three-second background poll", () => {
  const settings = normalizeSettings({
    gang: { intervalSeconds: 9, notify: true },
    profiles: { intervalSeconds: 3 },
  });
  assert.deepEqual(buildWatcherArgs("profiles", settings), [
    "src/cli.js",
    "profiles",
    "watch",
    "--live",
    "--interval",
    "3",
  ]);
});
