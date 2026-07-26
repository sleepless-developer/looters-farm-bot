import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { appDataDir } from "./vault.js";

export async function lockFilePath(name) {
  await mkdir(appDataDir(), { recursive: true });
  return join(appDataDir(), name);
}

export async function isPidAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readLockStatus(name) {
  const file = await lockFilePath(name);
  try {
    const lock = JSON.parse(await readFile(file, "utf8"));
    const pid = Number(lock.pid);
    return {
      path: file,
      exists: true,
      pid,
      startedAt: lock.startedAt,
      alive: await isPidAlive(pid),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: file, exists: false, alive: false };
    }
    return { path: file, exists: true, alive: false, error: error.message };
  }
}

export async function acquireLock(name, label = name) {
  const file = await lockFilePath(name);
  const status = await readLockStatus(name);
  if (status.exists && status.alive) {
    throw new Error(`${label} already running with pid=${status.pid}`);
  }
  if (status.exists) {
    await rm(file, { force: true });
  }

  const handle = await open(file, "wx");
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.close();
  return async () => rm(file, { force: true });
}
