import { readFile } from "node:fs/promises";
import { redact } from "./redact.js";

function actionFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  return url.searchParams.get("action") ?? "";
}

function parseJson(text) {
  if (!text || !String(text).trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function topKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value)
    .filter((key) => !/cookie|token|auth|session|secret|signature|jwt|bearer|password|private|email|avatar|authorization/i.test(key))
    .sort();
}

export async function summarizeHar(filePath) {
  const raw = await readFile(filePath, "utf8");
  const har = JSON.parse(raw);
  const entries = (har.log?.entries ?? []).filter((entry) => {
    try {
      const url = new URL(entry.request?.url ?? "");
      return url.hostname === "lootersnft.xyz" && url.pathname === "/api/game.php";
    } catch {
      return false;
    }
  });

  const groups = new Map();
  let latestPlayer = null;

  for (const entry of entries) {
    const method = entry.request?.method ?? "GET";
    const action = actionFromUrl(entry.request?.url ?? "");
    const status = Number(entry.response?.status ?? 0);
    const key = `${method}:${action}:${status}`;
    const response = parseJson(entry.response?.content?.text);
    const request = parseJson(entry.request?.postData?.text);
    const current = groups.get(key) ?? {
      method,
      action,
      status,
      count: 0,
      requestKeys: new Set(),
      responseKeys: new Set(),
    };
    current.count += 1;
    topKeys(request).forEach((name) => current.requestKeys.add(name));
    topKeys(response).forEach((name) => current.responseKeys.add(name));
    groups.set(key, current);

    if (method === "GET" && action === "me" && response?.player) {
      latestPlayer = pickGameplayPlayer(response.player);
    }
  }

  return redact({
    gameApiEntryCount: entries.length,
    endpoints: [...groups.values()]
      .map((row) => ({
        ...row,
        requestKeys: [...row.requestKeys].sort(),
        responseKeys: [...row.responseKeys].sort(),
      }))
      .sort((a, b) => a.action.localeCompare(b.action) || a.method.localeCompare(b.method)),
    latestPlayer,
  });
}

export function pickGameplayPlayer(player) {
  if (!player || typeof player !== "object") return null;
  return {
    loot: player.loot,
    earned: player.earned,
    energy: player.energy,
    energyMax: player.energyMax,
    nextEnergyIn: player.nextEnergyIn,
    heat: player.heat,
    jailLeft: player.jailLeft,
    bailCost: player.bailCost,
    gearMax: player.gearMax,
    machinePoints: player.machinePoints,
    machineIn: player.machineIn,
    cityEventNext: player.cityEventNext,
    gear: player.gear,
    perks: player.perks,
    targets: player.targets,
  };
}
