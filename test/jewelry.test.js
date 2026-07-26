import test from "node:test";
import assert from "node:assert/strict";
import { findHeistTarget, planAutoSuccessUpgrade, planAutoUpgrade, planJewelryHeistBatch, runJewelryHeistTick } from "../src/jewelry.js";

const player = {
  loot: 0,
  energy: 10,
  heat: 10,
  jailLeft: 0,
  nextEnergyIn: 60,
  targets: [
    { key: "store", energy: 1, chance: 30 },
    { key: "jewelry", energy: 2, chance: 21 },
  ],
};

const upgradePlayer = {
  ...player,
  loot: 300,
  perks: {
    drill: { 1: 1, 2: 1, 3: 1 },
    hack: { 1: 1, 2: 1 },
    wheels: { 1: 1, 2: 1, 3: 1 },
    inside: { 1: 1, 2: 1, 3: 1 },
    mask: {},
    bags: {},
  },
};

test("jewelry target finder accepts common typo alias", () => {
  assert.equal(findHeistTarget(player, "jewerly").key, "jewelry");
});

test("jewelry planner spends 10 energy as five jewelry heists when each costs 2", () => {
  const plan = planJewelryHeistBatch(player, { energyBudget: 10, targetMode: "fixed" });
  assert.equal(plan.type, "heist-batch");
  assert.equal(plan.runs, 5);
  assert.equal(plan.plannedEnergy, 10);
});

test("jewelry planner spends available energy up to configured budget", () => {
  const plan = planJewelryHeistBatch({ ...player, energy: 8 }, { energyBudget: 10, targetMode: "fixed" });
  assert.equal(plan.type, "heist-batch");
  assert.equal(plan.runs, 4);
  assert.equal(plan.plannedEnergy, 8);
});

test("jewelry planner can require the full budget when requested", () => {
  const plan = planJewelryHeistBatch({ ...player, energy: 8 }, { energyBudget: 10, requireFullBudget: true, targetMode: "fixed" });
  assert.equal(plan.type, "wait");
  assert.equal(plan.reason, "not-enough-budget-energy");
});

test("jewelry planner waits when energy is below one target cost", () => {
  const plan = planJewelryHeistBatch({ ...player, energy: 1 }, { energyBudget: 10, targetMode: "fixed" });
  assert.equal(plan.type, "wait");
  assert.equal(plan.reason, "not-enough-energy");
});

test("jewelry planner waits at heat cap", () => {
  const plan = planJewelryHeistBatch({ ...player, heat: 45 }, { heatCap: 45, targetMode: "fixed" });
  assert.equal(plan.type, "wait");
  assert.equal(plan.reason, "heat-cap");
});

test("scheduler default chooses minimum chance target at or above 24%", () => {
  const plan = planJewelryHeistBatch({
    ...player,
    energy: 10,
    targets: [
      { key: "atm", energy: 1, min: 60, max: 110, chance: 44 },
      { key: "store", energy: 1, min: 120, max: 210, chance: 35 },
      { key: "jewelry", energy: 2, min: 260, max: 430, chance: 26 },
      { key: "armored", energy: 2, min: 520, max: 820, chance: 23 },
    ],
  });
  assert.equal(plan.type, "heist-batch");
  assert.equal(plan.target, "jewelry");
  assert.equal(plan.chance, 26);
  assert.equal(plan.minChance, 24);
  assert.equal(plan.targetMode, "lowest-safe-chance");
});

test("scheduler switches to a newly unlocked lower safe chance target", () => {
  const plan = planJewelryHeistBatch({
    ...player,
    energy: 10,
    targets: [
      { key: "store", energy: 1, min: 120, max: 210, chance: 35 },
      { key: "jewelry", energy: 2, min: 260, max: 430, chance: 26 },
      { key: "armored", energy: 2, min: 520, max: 820, chance: 24 },
    ],
  });
  assert.equal(plan.type, "heist-batch");
  assert.equal(plan.target, "armored");
});

test("auto success upgrade planner chooses cheapest +SUC upgrade when enabled", () => {
  const plan = planAutoSuccessUpgrade(upgradePlayer, { autoUpgradeSuccess: true });
  assert.equal(plan.type, "upgrade");
  assert.equal(plan.upgrade.track, "drill");
  assert.equal(plan.upgrade.node, 4);
  assert.equal(plan.upgrade.cost, 250);
});

test("auto upgrade planner picks the cheapest available node across all selected effects", () => {
  const plan = planAutoUpgrade(upgradePlayer, {
    autoUpgradeEffectTypes: ["suc", "heat", "pay", "regen"],
  });
  assert.equal(plan.type, "upgrade");
  assert.equal(plan.upgrade.type, "pay");
  assert.equal(plan.upgrade.track, "bags");
  assert.equal(plan.upgrade.node, 1);
  assert.equal(plan.upgrade.cost, 100);
});

test("jewelry dry-run tick never posts heist", async () => {
  let posts = 0;
  const api = {
    async get(action) {
      assert.equal(action, "me");
      return { ok: true, player };
    },
    async post() {
      posts += 1;
    },
  };
  await runJewelryHeistTick(api, { dryRun: true, energyBudget: 10, intervalSeconds: 660, targetMode: "fixed" });
  assert.equal(posts, 0);
});

test("jewelry live tick posts one heist per planned run", async () => {
  const posts = [];
  const api = {
    async get(action) {
      assert.equal(action, "me");
      return { ok: true, player };
    },
    async post(action, body) {
      posts.push({ action, body });
      return { ok: true };
    },
  };
  await runJewelryHeistTick(api, { dryRun: false, energyBudget: 10, intervalSeconds: 660, runIntervalSeconds: 0, targetMode: "fixed" });
  assert.equal(posts.length, 5);
  assert.deepEqual(posts[0], { action: "heist", body: { target: "jewelry" } });
});

test("jewelry live tick can auto-upgrade cheapest success before heists", async () => {
  const posts = [];
  const afterUpgradePlayer = {
    ...upgradePlayer,
    loot: 50,
    perks: {
      ...upgradePlayer.perks,
      drill: { ...upgradePlayer.perks.drill, 4: 1 },
    },
  };
  let upgraded = false;
  const api = {
    async get(action) {
      assert.equal(action, "me");
      return { ok: true, player: upgraded ? afterUpgradePlayer : upgradePlayer };
    },
    async post(action, body) {
      posts.push({ action, body });
      if (action === "upgrade") upgraded = true;
      return { ok: true };
    },
  };

  await runJewelryHeistTick(api, {
    dryRun: false,
    energyBudget: 10,
    intervalSeconds: 660,
    runIntervalSeconds: 0,
    targetMode: "fixed",
    autoUpgradeSuccess: true,
  });

  assert.deepEqual(posts[0], { action: "upgrade", body: { track: "drill", node: 4 } });
  assert.equal(posts.filter((post) => post.action === "heist").length, 5);
});

test("jewelry live tick auto-claims dailies only when energy is zero", async () => {
  const calls = [];
  await runJewelryHeistTick({
    async get(action) {
      calls.push({ method: "GET", action });
      if (action === "me") return { ok: true, player: { ...player, energy: 0 } };
      if (action === "contracts") {
        return {
          ok: true,
          streak: { day: 6, claimed: false, rewards: [] },
          contracts: [{ id: "c1", done: true, claimed: false, rewardType: "loot" }],
        };
      }
      if (action === "streak_claim") return { ok: true, player: { ...player, energy: 0 } };
      throw new Error(`unexpected GET ${action}`);
    },
    async post(action, body) {
      calls.push({ method: "POST", action, body });
      return { ok: true };
    },
  }, {
    dryRun: false,
    energyBudget: 10,
    intervalSeconds: 660,
    runIntervalSeconds: 0,
    autoClaimDaily: true,
  });

  assert.equal(calls.some((call) => call.action === "heist"), false);
  assert.equal(calls.some((call) => call.action === "streak_claim"), true);
  assert.equal(calls.some((call) => call.action === "contract_claim"), true);
});

test("jewelry live batch waits three seconds between consecutive heists", async () => {
  const waits = [];
  await runJewelryHeistTick({
    async get(action) {
      assert.equal(action, "me");
      return { ok: true, player };
    },
    async post() {
      return { ok: true };
    },
  }, {
    dryRun: false,
    energyBudget: 10,
    intervalSeconds: 660,
    runIntervalSeconds: 3,
    targetMode: "fixed",
    sleepFn: async (ms) => waits.push(ms),
  });

  assert.deepEqual(waits, [3000, 3000, 3000, 3000]);
});
