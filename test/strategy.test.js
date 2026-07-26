import test from "node:test";
import assert from "node:assert/strict";
import {
  decideNextAction,
  isNodeEligible,
  planCheapestSelectedUpgrade,
  planCheapestSuccessUpgrade,
  planNextUpgrade,
  selectLowestSafeChanceHeistTarget,
  selectStableHeistTarget,
} from "../src/strategy.js";

const player = {
  loot: 300,
  energy: 2,
  heat: 9,
  jailLeft: 0,
  bailCost: 100,
  perks: {
    drill: { 1: 5, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 2, 9: 1 },
    hack: { 1: 2, 2: 1 },
    wheels: { 1: 2, 2: 1, 3: 1, 5: 1 },
    inside: { 1: 2, 2: 1, 3: 1 },
    mask: { 1: 2, 2: 3, 3: 1 },
    bags: { 1: 6, 2: 1, 3: 1 },
  },
  targets: [
    { key: "atm", energy: 1, min: 60, max: 110, chance: 39 },
    { key: "store", energy: 1, min: 120, max: 210, chance: 30 },
    { key: "jewelry", energy: 2, min: 260, max: 430, chance: 21 },
    { key: "reserve", energy: 5, min: 4200, max: 6800, chance: 7 },
  ],
};

test("stable heist selector chooses store under current backend snapshot", () => {
  const target = selectStableHeistTarget(player, { minChance: 20 });
  assert.equal(target.key, "store");
});

test("lowest safe chance selector chooses the riskiest target not below threshold", () => {
  const riskPlayer = {
    ...player,
    energy: 10,
    targets: [
      { key: "atm", energy: 1, min: 60, max: 110, chance: 44 },
      { key: "store", energy: 1, min: 120, max: 210, chance: 35 },
      { key: "jewelry", energy: 2, min: 260, max: 430, chance: 26 },
      { key: "armored", energy: 2, min: 520, max: 820, chance: 23 },
    ],
  };

  assert.equal(selectLowestSafeChanceHeistTarget(riskPlayer, { minChance: 24 }).key, "jewelry");

  const upgradedRiskPlayer = {
    ...riskPlayer,
    targets: riskPlayer.targets.map((target) => target.key === "armored" ? { ...target, chance: 24 } : target),
  };
  assert.equal(selectLowestSafeChanceHeistTarget(upgradedRiskPlayer, { minChance: 24 }).key, "armored");
});

test("upgrade planner chooses first affordable priority node", () => {
  const upgrade = planNextUpgrade(player, { affordableOnly: true });
  assert.equal(upgrade.track, "hack");
  assert.equal(upgrade.node, 3);
  assert.equal(upgrade.cost, 150);
});

test("cheapest success planner chooses the lowest absolute price", () => {
  const upgrade = planCheapestSuccessUpgrade(player, { affordableOnly: true });
  assert.equal(upgrade.track, "hack");
  assert.equal(upgrade.node, 3);
  assert.equal(upgrade.cost, 150);
  assert.equal(upgrade.value, 1);
  assert.equal(upgrade.reason, "cheapest-success");
});

test("selected upgrade planner filters effects and all four choose the cheapest node", () => {
  const payOnly = planCheapestSelectedUpgrade(player, {
    affordableOnly: true,
    effectTypes: ["pay"],
  });
  assert.equal(payOnly.type, "pay");
  assert.equal(payOnly.track, "mask");
  assert.equal(payOnly.node, 1);
  assert.equal(payOnly.cost, 169);

  const anySelected = planCheapestSelectedUpgrade(player, {
    affordableOnly: true,
    effectTypes: ["suc", "heat", "pay", "regen"],
  });
  assert.equal(anySelected.type, "suc");
  assert.equal(anySelected.track, "hack");
  assert.equal(anySelected.node, 3);
  assert.equal(anySelected.cost, 150);
  assert.equal(anySelected.reason, "cheapest-any-selected-effect");
});

test("eligibility respects dependency tree", () => {
  assert.equal(isNodeEligible(player, "hack", 5), true);
  assert.equal(isNodeEligible(player, "hack", 7), false);
});

test("worker decision blocks heist at high heat", () => {
  const action = decideNextAction({ ...player, loot: 0, heat: 45 }, { heatCap: 45 });
  assert.equal(action.type, "wait");
  assert.equal(action.reason, "heat-cap");
});

test("worker decision bails only under cap and balance", () => {
  const action = decideNextAction({ ...player, jailLeft: 100, bailCost: 80, loot: 100 }, { bailCap: 100 });
  assert.equal(action.type, "bail");
});
