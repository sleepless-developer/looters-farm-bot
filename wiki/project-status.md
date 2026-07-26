# Project status

Status: v0.1 local dry-run/live worker scaffold implemented.

Safety defaults:

- Main account plus named local profiles are supported.
- Per-profile proxies are supported; no rate-limit bypass logic, proxy rotation,
  or X/social-proof automation is implemented.
- API-only: `/api/game.php?action=...`.
- HTML/DOM and `.antibot` are not used.
- Session cookie stored outside repo with CurrentUser DPAPI.
- Worker defaults to dry-run unless `--live` is passed.

Current strategy:

- Default heist scheduler mode is `lowest-safe-chance` with `minChance=24`.
  It chooses the lowest live backend success chance that is still at or above
  the threshold, so `+SUC` upgrades can automatically unlock higher-risk runs.
- Legacy `stable-ev` mode remains available and chooses the max `EV/energy`
  target above the configured chance threshold.
- Old saved `fixed` target settings are migrated back to
  `lowest-safe-chance`; the local UI/console no longer expose the old manual
  target-key field.
- Heat cap `45`.
- Bail cap `100 loot`.
- Factories read-only in v1.
- Gang auto-accept is available, dry-run by default.
- Dedicated long-running `gang watch` exists for accepting requests without farming.
- Desktop notifications can be enabled with `--notify`; notifications contain request id and earned only.
- Dedicated `heist jewelry-watch` exists as the heist energy scheduler every
  11 minutes. Despite the legacy command name, its saved default target mode is
  now dynamic `lowest-safe-chance`, not fixed jewelry-only. It spends a
  configured 10-energy budget when not jailed and below heat cap, and it does
  not run the normal stable-target farm loop.
- Auto-upgrade is configured independently per account with four effect
  checkboxes: `+SUC`, `+HEAT`, `+PAY`, and `+REGEN`. The planner filters to
  selected effect types and buys the eligible node with the lowest absolute
  loot cost. Selecting all four chooses the cheapest eligible node across the
  full four-effect pool. Legacy `{enabled:true}` settings migrate to `SUC=true`
  with the other three effects disabled.
- Daily reward/contracts auto-claim is enabled in saved settings by default,
  but is protected by a hard `energy === 0` guard. It uses only backend
  `GET contracts`, `GET streak_claim`, and `POST contract_claim {id}`; if a
  profile has energy above zero, daily claim checks are skipped.
- `profiles watch` is the multi-profile autopilot. Each account has an
  independent persisted selection checkbox; the worker processes only checked
  accounts and skips unchecked accounts without loading their credentials.
  Existing settings default accounts to selected for backward compatibility.
- The detached multi-profile worker has its own `3`-second background poll.
  Each enabled profile is gated independently by the full `10`-energy budget.
  Once a batch starts, live heist requests are spaced by `3` seconds and the
  target/heat/state are rechecked between runs.

Current live watchers as of 2026-07-26 latest safe UI check:

- Local website UI is running on `127.0.0.1:8787`, pid `21916`, with the
  centered-body/draggable activity, checkbox-race, last-launch snapshot,
  single-mode, and consolidated Autopilot scheduler changes loaded. Static HTTP
  checks for `/`, `/app.js`, and `/app.css` returned `200`. The later
  default-collapsed square status drawer and natural-height settings layout
  source change awaits a separately approved UI refresh.
- Multi-profile worker was not started or stopped by the UI refresh. Its
  existing lock references pid `35784`, but that process is not alive; the lock
  is stale and autopilot is currently stopped.
- Legacy single-active `gang` and `jewelry` watchers are stopped, as required by
  watcher mutual exclusion.

Current safe distribution:

- `C:\Users\izxnxmi\Documents\CODEX PROJ\looters-farm-bot-safe-2026-07-26-r11.zip`
- Contents are allowlisted to README/package manifests, `src`, and `test`.
- Content and archive-entry scans found no blocking credentials/sensitive data;
  node_modules, wiki/operational history, runtime data, logs, HAR, DPAPI, `.env`,
  `.git`, and prior archives are excluded.
- SHA-256:
  `E97D28092766D6C35033C940B20FB842E810D6FB08E3E4F674149D1D6CFB0A8F`.
- Private GitHub repository:
  `https://github.com/sleepless-developer/looters-farm-bot`.
- Git push uses HTTPS. GitHub Actions runs least-privilege Node 22 checks with
  current Node 24-based checkout/setup actions; repository secrets are not
  required by the workflow.
- Root cause of prior proxy `fetch failed`: npm `undici` `ProxyAgent` was used
  with Node's global `fetch`, causing `UND_ERR_INVALID_ARG`. The API client now
  uses `fetch` from the same `undici` package as `ProxyAgent`.
- Interactive console is available with `node src/cli.js console`.
- Local website UI is available with `node src/cli.js ui` at
  `http://127.0.0.1:8787`.
- Local website UI has a RU/ENG selector in the top-right header. The language
  preference is stored only in browser `localStorage`.
- The header now summarizes the current feature set: multi-profile autopilot,
  gang auto-accept, energy/chance heists, per-account lowest-price selected
  upgrades (`SUC/HEAT/PAY/REGEN`), and daily reward/contracts claim only at
  `0` energy.
- The header also contains a safe live activity console for whitelisted
  heist/upgrade/gang/daily/tick/error summaries. Running watchers, enabled
  header features, checked settings, and active profile cards use monochrome
  glow indicators.
- Each Main/profile card shows one ordinary `Run together` selection checkbox;
  there are no Active/Standby labels. Any number of profiles can be selected
  simultaneously. The state is persisted under `automationByAccount`, applied
  optimistically in the UI, and honored by the all-profiles worker. The
  accounts header also has one `Select all profiles` action.
- The main UI has one execution mode only: a single multi-profile worker.
  `Start selected` runs checked accounts, `Start all` checks every account and
  starts that same worker, and `Stop autopilot` stops it. These controls now
  live inside the renamed `Autopilot scheduler` together with heist settings;
  the separate `Multi-profile autopilot` card was removed. Gang, daily claim,
  and upgrades are internal enabled modules. No Single-active watcher card,
  legacy process buttons, or legacy watcher HTTP routes are exposed.
- Per-account `+SUC/+HEAT/+PAY/+REGEN` and run-selection writes are serialized
  by the localhost backend. The browser keeps the clicked value as a sticky
  optimistic override until a newer ordered dashboard response confirms it;
  stale auto-refresh responses can no longer make a checkbox disappear and
  reappear.
- The Gang auto-accept settings card now uses a single running checkbox tied to
  the effective gang engine state instead of separate start/stop/reload
  buttons. While multi-profile autopilot is alive, the checkbox persists
  `gang.enabled` and controls gang handling inside the same profiles worker;
  it never starts a conflicting standalone process. The card reports
  `VIA AUTOPILOT` instead of the intentionally stopped legacy watcher.
- The page body is centered again. `BOT ACTIVITY` is a movable viewport-level
  window: drag its header with the cursor or touch, and the non-secret
  coordinates are saved in browser localStorage. Its position is clamped after
  drag, resize, restore, and feed updates so the window cannot disappear above,
  below, or beyond the visible page area. The feed keeps bounded scrolling.
- When profiles worker is alive, the status header reports the selected farm
  group, backend-readable selected accounts, effective Gang/Heist engines, and
  aggregate per-account auto-upgrade selections. It no longer presents one
  legacy active account or a single account's heist plan as the group status.
- Local website UI pauses auto-refresh while the user is editing form fields and
  preserves non-empty Cookie/proxy drafts during manual refresh, so typed values
  are not erased by the dashboard renderer.
- Non-secret settings are stored in
  `%APPDATA%\looters-farm-bot\settings.json`. Before a detached watcher launch,
  the normalized non-secret config is also saved to
  `last-launch-settings.json`; it is the fallback if the primary file is
  missing or malformed. Cookie/session remains in DPAPI only.
- Local website UI supports named cookie profiles and per-profile HTTP/HTTPS
  proxy URLs. Cookie/proxy values are encrypted with CurrentUser DPAPI; only
  masked proxy host info is displayed.
- Starting the all-profiles watcher from the UI stops legacy single-active
  watchers first to prevent duplicate actions on Main; starting a legacy
  watcher stops the all-profiles watcher.
