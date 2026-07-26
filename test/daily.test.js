import test from "node:test";
import assert from "node:assert/strict";
import { claimDailyRewards, normalizeClaimableContracts, shouldClaimStreak } from "../src/daily.js";

test("daily claim guard skips all claims while energy is above zero", async () => {
  const calls = [];
  const result = await claimDailyRewards({
    async get(action) {
      calls.push({ method: "GET", action });
      throw new Error("must not fetch contracts when player energy is known above zero");
    },
    async post(action, body) {
      calls.push({ method: "POST", action, body });
    },
  }, {
    dryRun: false,
    player: { energy: 1 },
  });

  assert.equal(result.checked, false);
  assert.equal(result.reason, "energy-not-zero");
  assert.deepEqual(calls, []);
});

test("daily claim normalizers select only completed unclaimed contracts and unclaimed streak", () => {
  assert.equal(shouldClaimStreak({ day: 2, claimed: false }), true);
  assert.equal(shouldClaimStreak({ day: 2, claimed: true }), false);
  assert.equal(shouldClaimStreak(null), false);

  const contracts = normalizeClaimableContracts({
    contracts: [
      { id: 1, done: true, claimed: false, rewardType: "loot" },
      { id: 2, done: false, claimed: false, rewardType: "loot" },
      { id: 3, done: true, claimed: true, rewardType: "loot" },
      { id: "bad space", done: true, claimed: false, rewardType: "loot" },
    ],
  });

  assert.deepEqual(contracts, [{ id: "1", rewardType: "loot", done: true, claimed: false }]);
});

test("daily claim dry-run reports streak and contracts without posting", async () => {
  const calls = [];
  const logs = [];
  const result = await claimDailyRewards({
    async get(action) {
      calls.push({ method: "GET", action });
      if (action === "contracts") {
        return {
          ok: true,
          streak: { day: 3, claimed: false, rewards: [{ type: "loot" }] },
          contracts: [{ id: "c1", done: true, claimed: false, rewardType: "loot" }],
        };
      }
      throw new Error(`unexpected GET ${action}`);
    },
    async post(action, body) {
      calls.push({ method: "POST", action, body });
    },
  }, {
    dryRun: true,
    player: { energy: 0 },
    accountId: "main",
    log: (message, data) => logs.push({ message, data }),
  });

  assert.equal(result.checked, true);
  assert.equal(result.streakAttempted, true);
  assert.equal(result.contractsFound, 1);
  assert.deepEqual(calls, [{ method: "GET", action: "contracts" }]);
  assert.deepEqual(logs.map((row) => row.message), ["dry-daily-streak-claim", "dry-daily-contract-claim"]);
});

test("daily claim live calls streak_claim and contract_claim only at zero energy", async () => {
  const calls = [];
  const result = await claimDailyRewards({
    async get(action) {
      calls.push({ method: "GET", action });
      if (action === "me") return { ok: true, player: { energy: 0 } };
      if (action === "contracts") {
        return {
          ok: true,
          streak: { day: 4, claimed: false, rewards: [] },
          contracts: [
            { id: "daily_a", done: true, claimed: false, rewardType: "loot" },
            { id: "daily_b", done: true, claimed: true, rewardType: "loot" },
          ],
        };
      }
      if (action === "streak_claim") return { ok: true, day: 4, reward: 100, player: { energy: 0 } };
      throw new Error(`unexpected GET ${action}`);
    },
    async post(action, body) {
      calls.push({ method: "POST", action, body });
      return { ok: true, player: { energy: 0 } };
    },
  }, {
    dryRun: false,
  });

  assert.equal(result.checked, true);
  assert.equal(result.streakClaimed, true);
  assert.equal(result.contractsClaimed, 1);
  assert.deepEqual(calls, [
    { method: "GET", action: "me" },
    { method: "GET", action: "contracts" },
    { method: "GET", action: "streak_claim" },
    { method: "POST", action: "contract_claim", body: { id: "daily_a" } },
  ]);
});
