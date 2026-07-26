import { numeric } from "./strategy.js";

const SAFE_ID = /^[a-z0-9_-]{1,80}$/i;

export function normalizeClaimableContracts(contractsResponse) {
  const contracts = Array.isArray(contractsResponse?.contracts) ? contractsResponse.contracts : [];
  return contracts
    .map((contract) => ({
      id: String(contract?.id ?? "").trim(),
      rewardType: safeWord(contract?.rewardType),
      done: truthy(contract?.done),
      claimed: truthy(contract?.claimed),
    }))
    .filter((contract) => SAFE_ID.test(contract.id) && contract.done && !contract.claimed);
}

export function shouldClaimStreak(streak) {
  if (!streak || typeof streak !== "object" || Array.isArray(streak)) return false;
  return falsy(streak.claimed);
}

export async function claimDailyRewards(api, options = {}) {
  const opts = {
    dryRun: true,
    accountId: undefined,
    player: undefined,
    contractsResponse: undefined,
    claimStreak: true,
    claimContracts: true,
    log: () => {},
    ...options,
  };

  const player = opts.player ?? await readPlayer(api);
  const energy = numeric(player?.energy, 0);
  if (energy !== 0) {
    return {
      checked: false,
      reason: "energy-not-zero",
      energy,
      streakClaimed: false,
      contractsClaimed: 0,
      dryRun: Boolean(opts.dryRun),
    };
  }

  const contractsResponse = opts.contractsResponse ?? await api.get("contracts");
  let streakClaimed = false;
  let streakAttempted = false;

  if (opts.claimStreak && shouldClaimStreak(contractsResponse?.streak)) {
    streakAttempted = true;
    opts.log(opts.dryRun ? "dry-daily-streak-claim" : "daily-streak-claim", {
      accountId: opts.accountId,
      day: safeNumber(contractsResponse.streak.day),
      rewardCount: Array.isArray(contractsResponse.streak.rewards) ? contractsResponse.streak.rewards.length : undefined,
    });
    if (!opts.dryRun) {
      await api.get("streak_claim");
      streakClaimed = true;
    }
  }

  const claimableContracts = opts.claimContracts ? normalizeClaimableContracts(contractsResponse) : [];
  let contractsClaimed = 0;
  for (const contract of claimableContracts) {
    opts.log(opts.dryRun ? "dry-daily-contract-claim" : "daily-contract-claim", {
      accountId: opts.accountId,
      id: contract.id,
      rewardType: contract.rewardType,
    });
    if (!opts.dryRun) {
      await api.post("contract_claim", { id: contract.id });
      contractsClaimed += 1;
    }
  }

  return {
    checked: true,
    energy,
    streakAttempted,
    streakClaimed: opts.dryRun ? false : streakClaimed,
    contractsFound: claimableContracts.length,
    contractsClaimed: opts.dryRun ? 0 : contractsClaimed,
    dryRun: Boolean(opts.dryRun),
  };
}

async function readPlayer(api) {
  const me = await api.get("me");
  if (!me?.player) throw new Error("Session is not authenticated or player object is missing.");
  return me.player;
}

function truthy(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function falsy(value) {
  return value === false || value === 0 || value === "0" || String(value).toLowerCase() === "false";
}

function safeWord(value) {
  const clean = String(value ?? "").trim();
  return /^[a-z0-9_-]{1,48}$/i.test(clean) ? clean : undefined;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
