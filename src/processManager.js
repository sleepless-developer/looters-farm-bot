import { openSync, closeSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { activeSessionAccountId, appDataDir } from "./vault.js";
import { lockFilePath, readLockStatus } from "./lock.js";
import { accountUpgradeEffectTypes, saveLastLaunchSettings } from "./settings.js";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const WATCHERS = Object.freeze({
  gang: {
    label: "Gang watcher",
    lockName: "gang-watch.lock",
    outLog: "gang-watch.out.log",
    errLog: "gang-watch.err.log",
    buildArgs(settings, context = {}) {
      const args = ["src/cli.js", "gang", "watch", "--live", "--interval", String(settings.gang.intervalSeconds)];
      if (settings.gang.notify) args.push("--notify");
      if (settings.gang.minEarned > 0) args.push("--min-earned", String(settings.gang.minEarned));
      if (settings.gang.max != null && Number.isFinite(settings.gang.max)) args.push("--max", String(settings.gang.max));
      return args;
    },
  },
  jewelry: {
    label: "Jewelry heist watcher",
    lockName: "jewelry-heist-watch.lock",
    outLog: "jewelry-heist.out.log",
    errLog: "jewelry-heist.err.log",
    buildArgs(settings, context = {}) {
      const args = [
        "src/cli.js",
        "heist",
        "jewelry-watch",
        "--live",
        "--interval",
        String(settings.jewelry.intervalSeconds),
        "--run-interval",
        String(settings.jewelry.runIntervalSeconds),
        "--energy",
        String(settings.jewelry.energyBudget),
        "--heat-cap",
        String(settings.jewelry.heatCap),
        "--target-mode",
        String(settings.jewelry.targetMode),
        "--min-chance",
        String(settings.jewelry.minChance),
      ];
      if (settings.jewelry.requireFullBudget) args.push("--require-full-budget");
      if (settings.daily?.enabled !== false) args.push("--auto-claim-daily");
      const effectTypes = accountUpgradeEffectTypes(settings, context.accountId ?? "main");
      if (effectTypes.length > 0 && settings.upgrade?.mode === "cheapest-success") {
        args.push("--auto-upgrade-types", effectTypes.join(","));
        args.push("--auto-upgrade-max", String(settings.upgrade.maxPerTick));
        args.push("--auto-upgrade-reserve", String(settings.upgrade.lootReserve));
      }
      return args;
    },
  },
  profiles: {
    label: "All profiles watcher",
    lockName: "all-profiles-watch.lock",
    outLog: "all-profiles.out.log",
    errLog: "all-profiles.err.log",
    buildArgs(settings, context = {}) {
      const interval = Math.max(1, Number(settings.profiles?.intervalSeconds) || 3);
      return ["src/cli.js", "profiles", "watch", "--live", "--interval", String(interval)];
    },
  },
});

export function buildWatcherArgs(name, settings, context = {}) {
  const watcher = WATCHERS[name];
  if (!watcher) throw new Error(`Unknown watcher: ${name}`);
  return watcher.buildArgs(settings, context);
}

export async function startWatcher(name, settings) {
  const watcher = WATCHERS[name];
  if (!watcher) throw new Error(`Unknown watcher: ${name}`);
  await stopConflictingWatchers(name);
  const status = await readLockStatus(watcher.lockName);
  if (status.alive) return { name, started: false, alreadyRunning: true, pid: status.pid };

  const dir = appDataDir();
  const context = { accountId: await activeSessionAccountId() };
  const args = watcher.buildArgs(settings, context);
  await mkdir(dir, { recursive: true });
  await saveLastLaunchSettings(settings);
  const outFd = openSync(join(dir, watcher.outLog), "a");
  const errFd = openSync(join(dir, watcher.errLog), "a");
  try {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", outFd, errFd],
    });
    child.unref();
    return { name, started: true, pid: child.pid, accountId: context.accountId, args };
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
}

async function stopConflictingWatchers(name) {
  const conflicts = name === "profiles"
    ? ["gang", "jewelry"]
    : name === "gang" || name === "jewelry"
      ? ["profiles"]
      : [];

  for (const conflict of conflicts) {
    const status = await readLockStatus(WATCHERS[conflict].lockName);
    if (status.alive) {
      await stopWatcher(conflict);
    }
  }
}

export async function stopWatcher(name) {
  const watcher = WATCHERS[name];
  if (!watcher) throw new Error(`Unknown watcher: ${name}`);
  const status = await readLockStatus(watcher.lockName);
  if (!status.alive) {
    if (status.exists) await rm(await lockFilePath(watcher.lockName), { force: true });
    return { name, stopped: false, alreadyStopped: true, pid: status.pid ?? null };
  }

  const result = spawnSync("taskkill.exe", ["/PID", String(status.pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Failed to stop ${watcher.label}`).trim());
  }
  await rm(await lockFilePath(watcher.lockName), { force: true });
  return { name, stopped: true, pid: status.pid };
}

export async function restartWatcher(name, settings) {
  const stopped = await stopWatcher(name);
  const started = await startWatcher(name, settings);
  return { name, stopped, started };
}

export async function watcherStatuses() {
  return {
    gang: await readLockStatus(WATCHERS.gang.lockName),
    jewelry: await readLockStatus(WATCHERS.jewelry.lockName),
    profiles: await readLockStatus(WATCHERS.profiles.lockName),
  };
}
