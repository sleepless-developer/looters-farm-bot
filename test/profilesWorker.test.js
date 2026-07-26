import test from "node:test";
import assert from "node:assert/strict";
import { runAllProfilesTick } from "../src/profilesWorker.js";
import { normalizeSettings, setAccountAutomationEnabled, setAccountUpgradeEffectEnabled } from "../src/settings.js";

const accounts = [
  {
    id: "main",
    kind: "main",
    name: "Main account",
    active: false,
    hasCookie: true,
    proxy: { hasProxy: false, maskedProxy: null },
  },
  {
    id: "alt_1",
    kind: "profile",
    name: "Alt 1",
    active: true,
    hasCookie: true,
    proxy: { hasProxy: true, maskedProxy: "http://user:pass@proxy.example" },
  },
];

function player() {
  return {
    loot: 0,
    energy: 10,
    heat: 0,
    jailLeft: 0,
    nextEnergyIn: 60,
    targets: [
      { key: "store", energy: 1, min: 120, max: 210, chance: 35 },
      { key: "jewelry", energy: 2, min: 260, max: 430, chance: 26 },
    ],
  };
}

test("all-profiles dry tick processes main and profile credentials independently", async () => {
  const seenCredentials = [];
  const apiGets = [];
  const settings = normalizeSettings({
    gang: { intervalSeconds: 5, notify: false },
    jewelry: { energyBudget: 10, requireFullBudget: true, targetMode: "lowest-safe-chance", minChance: 24 },
  });

  const result = await runAllProfilesTick(settings, {
    dryRun: true,
    accounts,
    credentialLoader: async (account) => {
      seenCredentials.push(account.id);
      return { account, cookie: `${account.id}=cookie`, proxyUrl: account.id === "main" ? null : "http://proxy.local:9000/" };
    },
    apiFactory: (credential) => ({
      async get(action) {
        apiGets.push({ id: credential.account.id, action, proxy: Boolean(credential.proxyUrl) });
        if (action === "gang") return { ok: true, requests: [{ id: `${credential.account.id}-r`, earned: 100 }] };
        if (action === "me") return { ok: true, player: player() };
        throw new Error(`unexpected action ${action}`);
      },
      async post() {
        throw new Error("dry-run must not post");
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(seenCredentials.sort(), ["alt_1", "main"]);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts.every((row) => row.gang.selected === 1), true);
  assert.equal(apiGets.some((row) => row.id === "alt_1" && row.proxy), true);
});

test("all-profiles tick skips each standby account independently", async () => {
  let settings = normalizeSettings({
    gang: { intervalSeconds: 5, notify: false },
  });
  settings = setAccountAutomationEnabled(settings, "main", false);
  settings = setAccountAutomationEnabled(settings, "alt_1", true);

  const loaded = [];
  const result = await runAllProfilesTick(settings, {
    dryRun: true,
    accounts,
    credentialLoader: async (account) => {
      loaded.push(account.id);
      return { account, cookie: `${account.id}=cookie`, proxyUrl: null };
    },
    apiFactory: () => ({
      async get(action) {
        if (action === "gang") return { ok: true, requests: [] };
        if (action === "me") return { ok: true, player: player() };
        throw new Error(`unexpected action ${action}`);
      },
      async post() {
        throw new Error("dry-run must not post");
      },
    }),
  });

  assert.deepEqual(loaded, ["alt_1"]);
  assert.equal(result.accounts.find((row) => row.account.id === "main").reason, "disabled");
  assert.equal(result.accounts.find((row) => row.account.id === "main").enabled, false);
  assert.equal(result.accounts.find((row) => row.account.id === "alt_1").enabled, true);
});

test("all-profiles autopilot can disable gang requests without stopping other modules", async () => {
  const settings = normalizeSettings({
    gang: { enabled: false, intervalSeconds: 5, notify: false },
  });
  const calls = [];
  const result = await runAllProfilesTick(settings, {
    dryRun: true,
    heist: false,
    daily: false,
    accounts,
    credentialLoader: async (account) => ({ account, cookie: `${account.id}=cookie`, proxyUrl: null }),
    apiFactory: (credential) => ({
      async get(action) {
        calls.push({ id: credential.account.id, action });
        throw new Error(`unexpected action ${action}`);
      },
      async post() {
        throw new Error("disabled gang module must not post");
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 0);
  assert.equal(result.accounts.every((row) => row.gang.reason === "disabled"), true);
});

test("all-profiles live tick uses per-account auto-upgrade toggle", async () => {
  let settings = normalizeSettings({
    gang: { intervalSeconds: 5, notify: false },
    jewelry: { energyBudget: 10, requireFullBudget: true, targetMode: "fixed", targetKey: "jewelry" },
    upgrade: { enabled: false, mode: "cheapest-success", maxPerTick: 10, lootReserve: 0 },
  });
  settings = setAccountUpgradeEffectEnabled(settings, "main", "suc", false);
  settings = setAccountUpgradeEffectEnabled(settings, "alt_1", "pay", true);

  const posts = [];
  await runAllProfilesTick(settings, {
    dryRun: false,
    accounts,
    heistSleepFn: async () => {},
    credentialLoader: async (account) => ({ account, cookie: `${account.id}=cookie`, proxyUrl: null }),
    apiFactory: (credential) => ({
      async get(action) {
        if (action === "gang") return { ok: true, requests: [] };
        if (action === "me") {
          return {
            ok: true,
            player: {
              ...player(),
              loot: credential.account.id === "alt_1" ? 500 : 0,
              perks: {
                drill: { 1: 1, 2: 1, 3: 1 },
                hack: {},
                wheels: {},
                inside: {},
                mask: {},
                bags: {},
              },
            },
          };
        }
        throw new Error(`unexpected action ${action}`);
      },
      async post(action, body) {
        posts.push({ id: credential.account.id, action, body });
        return { ok: true };
      },
    }),
  });

  assert.equal(posts.some((post) => post.id === "main" && post.action === "upgrade"), false);
  assert.equal(posts.some((post) => post.id === "alt_1" && post.action === "upgrade"), true);
  assert.deepEqual(posts.find((post) => post.id === "alt_1" && post.action === "upgrade").body, { track: "bags", node: 1 });
});

test("all-profiles daily claims only accounts with zero energy", async () => {
  const settings = normalizeSettings({
    gang: { intervalSeconds: 5, notify: false },
    daily: { enabled: true, claimStreak: true, claimContracts: true },
  });

  const calls = [];
  const result = await runAllProfilesTick(settings, {
    dryRun: false,
    heist: false,
    accounts,
    credentialLoader: async (account) => ({ account, cookie: `${account.id}=cookie`, proxyUrl: null }),
    apiFactory: (credential) => ({
      async get(action) {
        calls.push({ id: credential.account.id, method: "GET", action });
        if (action === "gang") return { ok: true, requests: [] };
        if (action === "me") {
          return {
            ok: true,
            player: {
              ...player(),
              energy: credential.account.id === "main" ? 1 : 0,
            },
          };
        }
        if (action === "contracts") {
          return {
            ok: true,
            streak: { day: 5, claimed: false, rewards: [] },
            contracts: [{ id: `${credential.account.id}_daily`, done: true, claimed: false, rewardType: "loot" }],
          };
        }
        if (action === "streak_claim") return { ok: true, player: { energy: 0 } };
        throw new Error(`unexpected action ${action}`);
      },
      async post(action, body) {
        calls.push({ id: credential.account.id, method: "POST", action, body });
        return { ok: true };
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.accounts.find((row) => row.account.id === "main").daily.checked, false);
  assert.equal(result.accounts.find((row) => row.account.id === "alt_1").daily.checked, true);
  assert.equal(calls.some((call) => call.id === "main" && call.action === "contracts"), false);
  assert.equal(calls.some((call) => call.id === "main" && call.action === "contract_claim"), false);
  assert.equal(calls.some((call) => call.id === "alt_1" && call.action === "streak_claim"), true);
  assert.equal(calls.some((call) => call.id === "alt_1" && call.action === "contract_claim"), true);
});
