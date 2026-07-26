import { numeric } from "./strategy.js";
import { acquireLock } from "./lock.js";
import { notifyGangAccepted } from "./notify.js";

const WATCH_DEFAULTS = Object.freeze({
  dryRun: true,
  intervalSeconds: 5,
  max: Number.POSITIVE_INFINITY,
  minEarned: 0,
  notify: false,
  once: false,
  lock: true,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gangLog(message, data = {}) {
  const parts = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`);
  console.log(`[${new Date().toISOString()}] ${message}${parts.length ? ` ${parts.join(" ")}` : ""}`);
}

export function normalizeGangRequests(gangResponse) {
  const requests = Array.isArray(gangResponse?.requests) ? gangResponse.requests : [];
  return requests
    .map((request) => ({
      id: String(request?.id ?? "").trim(),
      earned: numeric(request?.earned, 0),
    }))
    .filter((request) => request.id.length > 0);
}

export async function listGangRequests(api) {
  const response = await api.get("gang");
  const requests = normalizeGangRequests(response);
  return {
    ok: Boolean(response?.ok),
    gang: response?.gang
      ? {
          tag: response.gang.tag,
          role: response.gang.role,
          totalLoot: response.gang.totalLoot,
        }
      : null,
    count: requests.length,
    requests,
  };
}

export async function acceptGangRequests(api, options = {}) {
  const dryRun = options.dryRun ?? true;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Number.POSITIVE_INFINITY;
  const minEarned = Number.isFinite(Number(options.minEarned)) ? Number(options.minEarned) : 0;
  const notify = Boolean(options.notify);
  const status = await listGangRequests(api);
  const selected = status.requests
    .filter((request) => request.earned >= minEarned)
    .slice(0, max);

  const results = [];
  for (const request of selected) {
    if (dryRun) {
      results.push({ id: request.id, earned: request.earned, accepted: false, dryRun: true });
      continue;
    }
    try {
      const response = await api.post("request_respond", { request_id: request.id, accept: true });
      const row = { id: request.id, earned: request.earned, accepted: Boolean(response?.ok), dryRun: false };
      if (row.accepted) {
        notifyGangAccepted(row, { enabled: notify });
      }
      results.push(row);
    } catch (error) {
      results.push({ id: request.id, earned: request.earned, accepted: false, dryRun: false, error: error.message });
    }
  }

  return {
    gang: status.gang,
    found: status.count,
    selected: selected.length,
    dryRun,
    results,
  };
}

export async function watchGangRequests(api, options = {}) {
  const opts = { ...WATCH_DEFAULTS, ...options };
  const intervalSeconds = Math.max(1, numeric(opts.intervalSeconds, WATCH_DEFAULTS.intervalSeconds));
  const release = opts.lock ? await acquireLock("gang-watch.lock", "Gang watcher") : async () => {};

  try {
    gangLog(opts.dryRun ? "gang-watch-started-dry-run" : "gang-watch-started-live", {
      intervalSeconds,
      minEarned: opts.minEarned,
      max: Number.isFinite(opts.max) ? opts.max : "all",
      notify: opts.notify,
    });

    do {
      try {
        const result = await acceptGangRequests(api, opts);
        if (result.found > 0 || opts.once) {
          gangLog(opts.dryRun ? "dry-gang-watch-tick" : "gang-watch-tick", {
            found: result.found,
            selected: result.selected,
            accepted: result.results.filter((row) => row.accepted).length,
          });
          for (const row of result.results) {
            gangLog(row.accepted ? "gang-request-accepted" : "gang-request-seen", {
              id: row.id,
              earned: row.earned,
              dryRun: row.dryRun,
              error: row.error,
            });
          }
        }
      } catch (error) {
        gangLog("gang-watch-error", { message: error.message });
      }

      if (opts.once) break;
      await sleep(intervalSeconds * 1000);
    } while (true);
  } finally {
    await release();
  }
}
