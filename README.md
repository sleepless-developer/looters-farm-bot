# Looters Farm Bot

A local Windows bot for running multiple Looters profiles together through a
black-and-white localhost dashboard. The bot uses only the game's structured
backend API. It does not read HTML, the DOM, or `.antibot`.

## Features

- A direct Main account and additional profiles with individual HTTP/HTTPS proxies.
- Independent `Run together` checkboxes and a `Select all profiles` action.
- A background multi-profile worker that checks accounts every 3 seconds.
- A separate full 10-energy budget check for each selected profile.
- A 3-second pause between live heist requests within each batch.
- Automatic selection of the lowest available success chance at or above the
  configured threshold (24% by default).
- Heat protection: new heists are blocked at `heat >= 45` by default.
- Gang auto-accept inside the same multi-profile worker. Its checkbox enables
  or disables the gang module without stopping heist automation.
- Per-profile upgrades with independent `+SUC`, `+HEAT`, `+PAY`, and `+REGEN`
  checkboxes. The planner buys the cheapest eligible upgrade among the selected
  effects. Writes are serialized, and checkbox selections remain visible until
  a fresh dashboard response confirms them, preventing stale refreshes from
  undoing a recent selection.
- Automatic daily reward and completed daily contract claims only at 0 energy.
- An English-only interface, including controls, status messages, and prompts.
- A draggable `BOT ACTIVITY` panel that stays within the viewport and remembers
  its position locally. It displays heists, upgrades, gang requests, daily claims,
  worker ticks, and safe error categories.
- Glow indicators for running watchers and enabled features.
- A compact header with five square status cards, initially hidden behind
  `Show status`. Settings cards keep their natural height.

## Requirements

- Windows 10/11.
- Node.js 22 or later.
- npm.
- An authenticated Looters cookie session for each profile.

Twitter/X is used only for manual sign-in on the game website. The bot does not
store Twitter passwords or perform OAuth on its own.

## Installation

1. Clone the repository or extract a source ZIP into a separate folder.
2. Open PowerShell or CMD in that folder.
3. Install dependencies from the lockfile:

   ```powershell
   npm.cmd ci
   ```

4. Optionally run the local checks:

   ```powershell
   npm.cmd run check
   ```

## Start the localhost UI

Run this command from the project folder:

```powershell
node src/cli.js ui
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787) in your browser.

To use a different port:

```powershell
node src/cli.js ui --port 8790
```

The UI listens on localhost only. Keep its terminal window open. The
multi-profile worker runs as a separate background process and continues after
you close the browser tab.

## Initial setup

### Main account

1. Sign in to the game through Twitter/X in your regular browser.
2. Open DevTools > Network.
3. Select an authenticated request to `/api/game.php`.
4. Copy the complete `Cookie` request header.
5. Paste it into the Main Cookie field in the localhost UI and save it.

### Additional profiles

In the add-profile section, enter:

- A recognizable local name.
- The complete Cookie header.
- An optional proxy URL.

Supported standard proxy formats:

```text
http://user:pass@host:port
https://user:pass@host:port
```

After adding profiles, check `Run together` for the accounts you want to run,
or click `Select all profiles`.

## Start autopilot

1. Confirm that the selected profiles have saved cookie sessions.
2. Select the profiles using their `Run together` checkboxes.
3. Configure:
   - Energy budget: `10`.
   - Wait for full energy budget: enabled.
   - Seconds between runs: `3`.
   - Heat cap: `45`.
   - Min success chance: `24`.
4. Select upgrade categories for each profile: `+SUC`, `+HEAT`, `+PAY`, `+REGEN`.
5. In `Autopilot scheduler`, click:
   - `Start selected` to process only checked accounts.
   - `Start all` to select every account and start the same worker.

Scheduler settings and launch controls share one `Autopilot scheduler` section.
Gang auto-accept, daily claims, and upgrades run as internal modules of the
same worker. The UI does not expose legacy single-active watcher controls.

Before starting, the worker saves a normalized snapshot of all non-secret
settings to `last-launch-settings.json`. Subsequent launches normally use
`settings.json`. If that file is missing or malformed, the bot restores the
last launch configuration from the snapshot.

The worker checks each selected profile independently. Profiles with less than
10 energy wait. At 10 energy, it plans a guarded batch, pauses 3 seconds between
heists, and rechecks state between requests. A batch can end early due to the
heat cap, jail, insufficient energy, or a backend error.

The upgrade planner considers only available nodes in selected categories and
buys the node with the lowest absolute price. Selecting all four categories
allows the cheapest eligible upgrade across all four effects. Legacy
`Auto-upgrade cheapest +SUC` settings migrate to `+SUC` enabled and
`+HEAT/+PAY/+REGEN` disabled.

While the shared worker is running, `GANG ENGINE` and `HEIST ENGINE` status
cards show `VIA AUTOPILOT`. Separate legacy processes are intentionally stopped
to prevent duplicate requests. The gang auto-accept checkbox controls the
module without restarting or stopping the shared worker.

Click `Stop autopilot` to stop background actions.

## Credential safety

Source distributions do not include cookies, proxy credentials, tokens, HAR
files, runtime logs, or local settings.

At runtime, credentials are stored outside the project folder:

```text
%APPDATA%\looters-farm-bot\
```

- Cookies and proxy credentials are encrypted with Windows CurrentUser DPAPI.
- `settings.json` and `last-launch-settings.json` contain only non-secret
  automation settings. The latter is a backup of the last launch configuration.
- Encrypted credentials can be decrypted only by the same Windows user.
- Credential values are never returned to the UI or printed in safe logs.
- Do not transfer `%APPDATA%\looters-farm-bot` files between computers.
- Do not add cookies, `.env`, HAR, or DPAPI files to the project folder.

## Common CLI commands

```text
node src/cli.js ui
node src/cli.js console
node src/cli.js doctor
node src/cli.js profiles check
node src/cli.js profiles tick --dry-run
node src/cli.js profiles watch --live --interval 3
node src/cli.js gang auto-accept --dry-run
node src/cli.js heist jewelry-plan
```

Live commands perform real backend actions. Use `--dry-run` for a preview
where supported.

## Excluded from source distributions

- `node_modules`.
- `.git` in packaged release archives.
- `.env` and secret-bearing local configuration.
- Cookies, proxy credentials, and DPAPI storage.
- HAR files and raw request dumps.
- Runtime logs.
- Previous ZIP archives.
- Browser and Twitter/X data.

## Repository language

Maintain all GitHub-facing content in English: documentation, code comments,
UI and CLI messages, commit messages, issue and pull request text, and release
notes. Preserve API identifiers, commands, proper names, and user-supplied data.
See [AGENTS.md](AGENTS.md) for contributor guidance.
