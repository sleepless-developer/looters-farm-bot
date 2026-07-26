#!/usr/bin/env node
import { summarizeHar } from "./har.js";
import { safeLogObject } from "./redact.js";
import { hasSessionCookie, loadActiveProfileProxyUrl, loadSessionCookie, promptAndSaveSessionCookie, clearSessionCookie, sessionBlobPath } from "./vault.js";
import { LootersApiClient } from "./apiClient.js";
import { previewPlan, runWorker } from "./worker.js";
import { acceptGangRequests, listGangRequests, watchGangRequests } from "./gang.js";
import { planAutoSuccessUpgrade, planJewelryHeistBatch, watchJewelryHeists } from "./jewelry.js";
import { readLockStatus } from "./lock.js";
import { runConsoleUi } from "./consoleUi.js";
import { startWebUiServer } from "./webUi.js";
import { loadSettings } from "./settings.js";
import { checkAllProfiles, runAllProfilesTick, watchAllProfiles } from "./profilesWorker.js";

function parseArgs(argv) {
  const out = { _: [] };
  const booleanFlags = new Set(["live", "dry-run", "once", "accept-requests", "notify", "require-full-budget", "auto-upgrade-success", "auto-claim-daily"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      out[key] = true;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[i + 1];
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`Looters stable farm bot

Commands:
  vault set-cookie              Store Looters Cookie header in CurrentUser DPAPI
  vault clear-cookie            Remove saved session cookie
  vault status                  Show whether encrypted cookie exists
  status                        Read backend state and print safe plan preview
  gang requests                 Show pending gang join requests safely
  gang auto-accept              Accept pending gang join requests; dry-run is default
  gang watch                    Keep waiting for gang requests; dry-run is default
  gang watch-status             Show whether gang watcher lock is alive
  heist jewelry-watch           Spend energy on selected safe heist targets
  heist jewelry-plan            Show current safe heist plan
  heist jewelry-status          Show whether jewelry watcher lock is alive
  profiles check                Safe connectivity/status check for Main + profiles
  profiles tick                 One all-profiles autopilot tick; dry-run is default
  profiles watch                Keep Main + all profiles working together
  har-summary --har <path>      Summarize game API endpoints from HAR without secrets
  worker [--dry-run|--live]     Start autopilot loop; dry-run is default
  worker --once --dry-run       One safe decision tick
  doctor                        Check local vault + Node runtime
  console                       Interactive terminal UI for settings, cookies, watchers
  ui [--host 127.0.0.1] [--port 8787]
                               Local website UI for settings, cookies, watchers

Worker options:
  --heat-cap 45                 Stop heists at or above this heat
  --bail-cap 100                Max auto-bail spend in loot
  --target-mode <mode>          stable-ev or lowest-safe-chance
  --min-chance 24               Minimum success chance for heist target
  --interval 15                 Check interval seconds
  --accept-requests             Worker also accepts gang join requests

Gang options:
  --max <n>                     Max requests to accept in one run
  --min-earned <n>              Accept only users with earned >= n
  --interval <seconds>          Watch poll interval; default 5
  --notify                      Desktop notification for every accepted request

Jewelry options:
  --interval <seconds>          Heist interval; default 660 (11 minutes)
  --run-interval <seconds>      Delay between heists inside a batch; default 3
  --energy <n>                  Energy budget per tick; default 10
  --require-full-budget         Wait for full energy budget instead of spending available energy
  --heat-cap <n>                Skip heist at or above this heat; default 45
  --target-mode <mode>          lowest-safe-chance or stable-ev; default lowest-safe-chance
  --min-chance <n>              Minimum success chance for dynamic modes; default 24
  --auto-upgrade-success        Legacy alias for --auto-upgrade-types suc
  --auto-upgrade-types <list>   Comma list: suc,heat,pay,regen; buys lowest-price eligible selected effect
  --auto-upgrade-max <n>        Max auto upgrades per tick; default 10
  --auto-upgrade-reserve <n>    Keep this loot unspent; default 0
  --auto-claim-daily            Claim daily streak/contracts only when energy is 0

Profiles options:
  --interval <seconds>          Multi-profile watcher poll interval; default 3
  --timeout <ms>                Per-account request timeout; default 15000
`);
}

async function makeApi() {
  const cookie = await loadSessionCookie();
  const proxyUrl = await loadActiveProfileProxyUrl();
  return new LootersApiClient({ cookie, proxyUrl });
}

function requirePlayer(me) {
  if (!me?.player) {
    throw new Error("Session is not signed in or player object is missing. Refresh cookie with: node src/cli.js vault set-cookie");
  }
  return me.player;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, subcommand] = args._;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "console") {
    await runConsoleUi();
    return;
  }

  if (command === "ui" || command === "web-ui") {
    await startWebUiServer({
      host: args.host ?? "127.0.0.1",
      port: args.port ? Number(args.port) : 8787,
    });
    await new Promise(() => {});
    return;
  }

  if (command === "vault") {
    if (subcommand === "set-cookie") {
      console.log("Paste full Cookie header for authenticated lootersnft.xyz request.");
      console.log("Correct source: DevTools -> Network -> /api/game.php -> Request Headers -> Cookie.");
      console.log("Accepted forms: Cookie: a=b; c=d  OR  a=b; c=d");
      console.log("Also accepted: DevTools/Application cookie row like: PHPSESSID <value> lootersnft.xyz ...");
      console.log("Input is hidden by PowerShell and encrypted with Windows CurrentUser DPAPI.");
      await promptAndSaveSessionCookie();
      console.log(`Saved encrypted session cookie: ${sessionBlobPath()}`);
      return;
    }
    if (subcommand === "clear-cookie") {
      await clearSessionCookie();
      console.log("Removed encrypted session cookie.");
      return;
    }
    if (subcommand === "status") {
      console.log(safeLogObject({ hasSessionCookie: await hasSessionCookie(), path: sessionBlobPath() }));
      return;
    }
    throw new Error("Unknown vault command. Use: vault set-cookie|clear-cookie|status");
  }

  if (command === "har-summary") {
    const har = args.har;
    if (!har) throw new Error("Missing --har <path>");
    console.log(safeLogObject(await summarizeHar(har)));
    return;
  }

  if (command === "status") {
    const api = await makeApi();
    const me = await api.get("me");
    const player = requirePlayer(me);
    console.log(safeLogObject({
      resources: {
        loot: player.loot,
        energy: player.energy,
        heat: player.heat,
        jailLeft: player.jailLeft,
        nextEnergyIn: player.nextEnergyIn,
      },
      ...previewPlan(player, {
      heatCap: args["heat-cap"],
      bailCap: args["bail-cap"],
      targetMode: args["target-mode"],
      minChance: args["min-chance"],
      }),
    }));
    return;
  }

  if (command === "gang") {
    if (subcommand === "watch-status") {
      console.log(safeLogObject(await readLockStatus("gang-watch.lock")));
      return;
    }
    const api = await makeApi();
    if (subcommand === "requests") {
      console.log(safeLogObject(await listGangRequests(api)));
      return;
    }
    if (subcommand === "auto-accept") {
      console.log(safeLogObject(await acceptGangRequests(api, {
        dryRun: args.live ? false : true,
        max: args.max ? Number(args.max) : undefined,
        minEarned: args["min-earned"] ? Number(args["min-earned"]) : undefined,
        notify: Boolean(args.notify),
      })));
      return;
    }
    if (subcommand === "watch") {
      await watchGangRequests(api, {
        dryRun: args.live ? false : true,
        once: Boolean(args.once),
        intervalSeconds: args.interval ? Number(args.interval) : undefined,
        max: args.max ? Number(args.max) : undefined,
        minEarned: args["min-earned"] ? Number(args["min-earned"]) : undefined,
        notify: Boolean(args.notify),
      });
      return;
    }
    throw new Error("Unknown gang command. Use: gang requests|auto-accept|watch|watch-status");
  }

  if (command === "heist") {
    if (subcommand === "jewelry-status") {
      console.log(safeLogObject(await readLockStatus("jewelry-heist-watch.lock")));
      return;
    }
    if (subcommand === "jewelry-watch") {
      const api = await makeApi();
      await watchJewelryHeists(api, {
        dryRun: args.live ? false : true,
        once: Boolean(args.once),
        intervalSeconds: args.interval ? Number(args.interval) : undefined,
        runIntervalSeconds: args["run-interval"] ? Number(args["run-interval"]) : undefined,
        energyBudget: args.energy ? Number(args.energy) : undefined,
        heatCap: args["heat-cap"] ? Number(args["heat-cap"]) : undefined,
        targetMode: args["target-mode"],
        minChance: args["min-chance"] ? Number(args["min-chance"]) : undefined,
        targetKey: args.target,
        requireFullBudget: Boolean(args["require-full-budget"]),
        autoUpgradeEffectTypes: args["auto-upgrade-types"],
        autoUpgradeSuccess: Boolean(args["auto-upgrade-success"]),
        autoUpgradeMaxPerTick: args["auto-upgrade-max"] ? Number(args["auto-upgrade-max"]) : undefined,
        autoUpgradeLootReserve: args["auto-upgrade-reserve"] ? Number(args["auto-upgrade-reserve"]) : undefined,
        autoClaimDaily: Boolean(args["auto-claim-daily"]),
      });
      return;
    }
    if (subcommand === "jewelry-plan") {
      const api = await makeApi();
      const me = await api.get("me");
      const player = requirePlayer(me);
      console.log(safeLogObject({
        resources: {
          energy: player.energy,
          heat: player.heat,
          jailLeft: player.jailLeft,
          nextEnergyIn: player.nextEnergyIn,
        },
        plan: planJewelryHeistBatch(player, {
          intervalSeconds: args.interval ? Number(args.interval) : undefined,
          runIntervalSeconds: args["run-interval"] ? Number(args["run-interval"]) : undefined,
          energyBudget: args.energy ? Number(args.energy) : undefined,
          heatCap: args["heat-cap"] ? Number(args["heat-cap"]) : undefined,
          targetMode: args["target-mode"],
          minChance: args["min-chance"] ? Number(args["min-chance"]) : undefined,
          targetKey: args.target,
          requireFullBudget: Boolean(args["require-full-budget"]),
        }),
        autoSuccessUpgrade: planAutoSuccessUpgrade(player, {
          autoUpgradeEffectTypes: args["auto-upgrade-types"],
          autoUpgradeSuccess: Boolean(args["auto-upgrade-success"]),
          autoUpgradeLootReserve: args["auto-upgrade-reserve"] ? Number(args["auto-upgrade-reserve"]) : undefined,
        }),
      }));
      return;
    }
    throw new Error("Unknown heist command. Use: heist jewelry-watch|jewelry-plan|jewelry-status");
  }

  if (command === "profiles") {
    const settings = await loadSettings();
    if (subcommand === "check" || subcommand === "status") {
      console.log(safeLogObject(await checkAllProfiles(settings, {
        timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      })));
      return;
    }
    if (subcommand === "tick") {
      console.log(safeLogObject(await runAllProfilesTick(settings, {
        dryRun: args.live ? false : true,
        once: true,
        timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      })));
      return;
    }
    if (subcommand === "watch") {
      await watchAllProfiles(settings, {
        dryRun: args.live ? false : true,
        once: Boolean(args.once),
        intervalSeconds: args.interval ? Number(args.interval) : settings.profiles.intervalSeconds,
        timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      });
      return;
    }
    throw new Error("Unknown profiles command. Use: profiles check|tick|watch");
  }

  if (command === "worker") {
    await runWorker({
      dryRun: args.live ? false : true,
      once: Boolean(args.once),
      heatCap: args["heat-cap"] ? Number(args["heat-cap"]) : undefined,
      bailCap: args["bail-cap"] ? Number(args["bail-cap"]) : undefined,
      targetMode: args["target-mode"],
      minChance: args["min-chance"] ? Number(args["min-chance"]) : undefined,
      intervalSeconds: args.interval ? Number(args.interval) : undefined,
      acceptRequests: Boolean(args["accept-requests"]),
      acceptRequestsMax: args.max ? Number(args.max) : undefined,
      acceptRequestsMinEarned: args["min-earned"] ? Number(args["min-earned"]) : undefined,
      autoClaimDaily: args["auto-claim-daily"] ? true : undefined,
      notify: Boolean(args.notify),
    });
    return;
  }

  if (command === "doctor") {
    console.log(safeLogObject({
      node: process.version,
      platform: process.platform,
      hasSessionCookie: await hasSessionCookie(),
      vaultPath: sessionBlobPath(),
      livePostDefault: false,
    }));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
