# Log

## 2026-07-22

- Created the standalone `looters-farm-bot` project in the local project workspace.
- Implemented API-only stable farm worker using backend-derived game fields from the provided HAR.
- Added CurrentUser DPAPI session-cookie vault outside the repo.
- Added tests for redaction, `.antibot` independence, stable target selection, upgrade dependency checks, heat guard, and bail guard.
- Added `.gitignore` for HAR, DPAPI, env, logs, and dependency/build artifacts.

## 2026-07-24

- Added backend-request gang auto-accept: `GET action=gang` then `POST action=request_respond` with `accept=true`.
- Added `gang requests`, `gang auto-accept`, and worker `--accept-requests`.
- Documented Twitter/X auth as a manual browser login used only to obtain the local encrypted game cookie.
- Improved cookie-vault UX: accepts `Cookie: ...` prefix, explains DevTools source, and reports missing vault with a clear action.
- Added support for DevTools/Application tabular cookie rows, normalized locally into an HTTP Cookie header without logging values.
- Fixed DPAPI vault read/write compatibility by stripping UTF-8 BOM on read and writing encrypted blobs without BOM.
- Added dedicated long-running `gang watch` mode with a lock file, safe logs, and configurable poll interval.
- Started live background `gang watch` on this machine with 5-second polling; process pid was recorded only as safe operational status, no session data logged.
- Added optional `--notify` desktop notifications for each accepted gang request and fixed boolean CLI flag parsing.
- Restarted live background `gang watch` with desktop notifications enabled.
- Stopped live background `gang watch` process on user request; no watcher process remained alive after verification.
- Restarted live background `gang watch` on user request with 5-second polling and desktop notifications enabled.

## 2026-07-26

- Added dedicated jewelry-only heist scheduler: `heist jewelry-watch`.
- Default jewelry scheduler parameters: target `jewelry`, interval `660` seconds,
  energy budget `10`, heat cap `45`, dry-run unless `--live`.
- Added `heist jewelry-status` lock status command using a separate
  `jewelry-heist-watch.lock`, so it can run alongside gang auto-accept without
  invoking the normal upgrade/stable-farm worker.
- Added tests for jewelry target aliasing, 10-energy batch planning, energy/heat
  guards, dry-run no-post behavior, and live mock POST count.
- Verified `npm run check`: 20 tests passed.
- Started live background `gang watch` with 5-second polling and desktop
  notifications enabled; safe lock status reported alive with pid `12912`.
- Started live background `heist jewelry-watch` with interval `660` seconds and
  energy budget `10`; safe lock status reported alive with pid `19260`.
- Safe backend status after launch reported `no-energy`, so further jewelry
  heists wait for energy recovery and the next scheduler tick.
- Investigated missing energy spend after user report. `gang requests` returned
  backend error `Not signed in`; `me.player` was missing, so the saved DPAPI
  session cookie is expired/invalid.
- Stopped stale live watcher processes `12912` and `19260`; both lock statuses
  now report `alive=false`.
- Fixed diagnostics so `status` and `heist jewelry-plan` fail clearly when
  `me.player` is missing instead of showing a misleading `no-energy` plan.
- Changed jewelry scheduler default from "wait for exactly 10 energy" to
  "spend up to 10 energy when at least one jewelry heist is available"; strict
  full-budget waiting remains available via `--require-full-budget`.
- Verified `npm run check`: 22 tests passed.
- After refreshed session cookie, verified backend status: `energy=10`,
  `heat=0`, `jailLeft=0`; `heist jewelry-plan` planned 5 jewelry heists for
  10 energy.
- Restarted live background watchers: gang watcher pid `1556`, jewelry watcher
  pid `6980`; both locks reported alive.
- Jewelry watcher immediately executed 5 live `jewelry` heists. Follow-up safe
  status reported `energy=0`, `heat=30`, `jailLeft=0`, confirming energy spend.
- User requested energy-threshold scheduling instead of fixed 11-minute spend.
  Restarted jewelry watcher in strict full-budget mode:
  `heist jewelry-watch --live --energy 10 --require-full-budget --interval 660`.
- New jewelry watcher lock reports alive with pid `3912`. Safe plan at restart
  reported `energy=2`, `requiredEnergy=10`, reason
  `not-enough-budget-energy`, so no premature heist is performed.
- Added interactive terminal UI command: `node src/cli.js console`.
- Console UI supports safe dashboard, DPAPI cookie update/clear, gang settings,
  jewelry settings, and start/stop/restart for gang/jewelry watchers.
- Added non-secret persisted settings at
  `%APPDATA%\looters-farm-bot\settings.json`; current saved defaults are gang
  interval `5` with notifications on, and jewelry full-budget mode with
  `energyBudget=10`, interval `660`, heat cap `45`.
- Added `src/processManager.js` for detached watcher start/stop via existing
  locks and safe stdout/stderr log files.
- Added localhost web UI command: `node src/cli.js ui`.
- Web UI binds only to loopback, uses a per-process CSRF token for POST actions,
  never displays current cookie/session values, and controls only existing
  DPAPI cookie/settings/watcher APIs.
- Verified `npm run check`: 27 tests passed.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `33844`; dashboard now
  exposes safe `gameState` resource/plan fields without returning cookies or raw
  session data.
- Added optional cheapest `+SUC` auto-upgrade for the jewelry watcher. It is
  controlled by the localhost UI checkbox `Auto-upgrade cheapest +SUC` and by
  CLI flag `--auto-upgrade-success`; it buys only eligible `suc` nodes sorted by
  `cost / +SUC`, never pay/crit/heat/regen/jail nodes in this mode.
- Verified `npm run check`: 31 tests passed.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `29300`, to expose the
  new auto-upgrade checkbox. Existing live gang/jewelry watcher processes were
  not restarted, so auto-upgrade remains inactive until the user enables the
  checkbox and restarts jewelry watcher.
- Added named DPAPI profiles for Cookie headers and per-profile HTTP/HTTPS proxy
  URLs. API requests use the active profile proxy through `undici` `ProxyAgent`.
  UI displays only masked proxy info and never returns raw cookie/proxy values.
- Verified `npm run check`: 32 tests passed.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `4924`, with the new
  Profiles + Proxy controls.
- Reworked localhost UI/UX into a black-and-white account dashboard: Main
  account is shown separately as direct/no-proxy, proxy profiles are shown as
  account cards with safe stats, masked proxy status, active switch, and update
  actions. Dashboard `accounts` API returns safe resource/plan summaries only.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `35948`.
- Fixed settings checkbox/input UX: local UI now autosaves gang/jewelry/upgrade
  settings on field `change` and guards active edits from the 5-second refresh,
  so `Auto-upgrade cheapest +SUC` no longer visually reverts before restart.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `34040`.
- Changed auto-upgrade UX from one global checkbox to per-account checkboxes in
  each account card. Settings now store `upgradeByAccount`, and the jewelry
  watcher uses the active account id when deciding whether to pass
  `--auto-upgrade-success`.
- Added proxy normalization for compact `host:port:user:pass` and
  `http://host:port:user:pass:` formats; values are converted to standard
  `http://user:pass@host:port/` before DPAPI storage.
- Verified `npm run check`: 33 tests passed.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `10780`.

## 2026-07-26 — dynamic risk heist selector

- Added `lowest-safe-chance` heist selection mode. It filters backend targets by
  live `chance >= 24` and available energy budget, then chooses the lowest
  remaining chance so `+SUC` upgrades can automatically unlock higher-risk runs.
- The legacy `heist jewelry-watch` command now supports `--target-mode`,
  `--min-chance`, and fixed `--target`; saved defaults are
  `targetMode=lowest-safe-chance` and `minChance=24`.
- Localhost web UI and terminal console now expose the target mode and minimum
  chance settings. Existing running watchers must be restarted to pick up the
  changed selector.
- Verified `npm run check`: 37 tests passed.
- Restarted localhost web UI on `127.0.0.1:8787`, pid `24584`.
- Live heist watcher was not restarted in this change because the currently
  active proxy profile returned safe status `fetch failed`; the main direct
  account still returned backend status safely. Restart after selecting main or
  a working proxy profile.

## 2026-07-26 — all-profiles autopilot and proxy fix

- Diagnosed per-profile `fetch failed`: both proxy endpoints were TCP-reachable,
  but API calls failed with `UND_ERR_INVALID_ARG` because npm `undici`
  `ProxyAgent` was used together with Node's global `fetch`.
- Fixed `src/apiClient.js` to use `undici` `fetch` from the same package as
  `ProxyAgent`, then `profiles check` returned `ok=true` for Main and both
  saved proxy profiles.
- Added `profiles check`, `profiles tick`, and `profiles watch` commands.
  `profiles watch` processes Main and every saved profile in one loop with
  isolated DPAPI Cookie/proxy credentials and per-account auto-upgrade settings.
- Added `src/profilesWorker.js`, profile watcher process management, UI
  controls/status card, and tests for all-profiles ticks.
- `npm run check` passed: 40 tests.
- Restarted localhost UI on `127.0.0.1:8787`, pid `35528`.
- Started live all-profiles watcher: pid `36792`, lock
  `all-profiles-watch.lock`. Legacy single-active gang/jewelry watchers were
  stopped to prevent duplicate actions on Main. First live all-profiles cycle
  reported `accounts=3 ok=3 failed=0`.

## 2026-07-26 — localhost UI form stability cleanup

- Removed the user-facing manual target-key control from the localhost web UI,
  terminal console, CLI help, README, and process-manager startup args. Old
  saved `targetMode=fixed` settings now normalize back to
  `lowest-safe-chance`.
- Renamed the old polling-interval wording to `Check interval seconds`, because
  it is the check frequency, not a guaranteed delay between heist runs.
- Hardened the web UI auto-refresh: background dashboard refresh now pauses
  while any form field is being edited, and non-empty Cookie/proxy/profile input
  drafts are restored during forced refreshes.
- Renamed restart controls to reload/process wording and documented the split:
  legacy single-active watchers read settings at process start, so reload applies
  saved changes to already-running legacy processes; multi-profile watcher
  rereads settings/Cookie/proxy data each cycle, so reload there is mainly for
  recovery or code changes.
- Verified `npm run check`: 40 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `32060`. Safe dashboard check
  returned `targetMode=lowest-safe-chance`, `minChance=24`,
  `requireFullBudget=true`. Current safe watcher status: legacy jewelry watcher
  alive pid `34228`, all-profiles watcher not running.

## 2026-07-26 — profile card layout fix

- Fixed broken profile-card display in the localhost UI: the profile grid now
  uses wider responsive cards, profile cards clip their own overflow, long
  masked proxy/id/status strings wrap inside the card, stat tiles auto-fit, and
  action rows wrap without overlapping neighboring cards.
- Added CSS regression assertions to the web UI test for the two-column guard,
  overflow wrapping, and profile-row layout guard.
- Verified `npm run check`: 40 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `17672`. Safe dashboard check
  returned `profileCount=4`, `targetMode=lowest-safe-chance`, legacy jewelry
  watcher alive pid `34228`, and all-profiles watcher not running.

## 2026-07-26 — daily reward/contracts auto-claim guard

- Added backend-only daily claim module. It treats daily reward as
  `GET contracts -> streak` plus `GET streak_claim`, and daily tasks as
  completed/unclaimed `contracts` plus `POST contract_claim {id}`. No HTML/DOM
  or `.antibot` data is used.
- Added a hard `energy === 0` guard before any daily claim. If a profile has
  energy above zero, the claimer skips contract fetch/claim work.
- Integrated the guard into the single worker, legacy `heist jewelry-watch`, and
  the all-profiles autopilot. The localhost UI and console now expose
  `Auto-claim daily reward/contracts at 0 energy`; saved settings default to
  enabled with `requireZeroEnergy=true`.
- Extended API allowlist with safe backend `GET streak_claim`.
- Added tests for daily normalizers, dry-run behavior, live claim calls, the
  jewelry watcher wait-at-zero-energy path, and per-profile energy gating.
- Verified `npm run check`: 46 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `10832`. Safe dashboard check
  returned `dailyEnabled=true`, `requireZeroEnergy=true`, legacy jewelry watcher
  alive pid `34228`, and all-profiles watcher not running. Existing live worker
  was not reloaded automatically to avoid triggering an immediate live tick.

## 2026-07-26 — RU/ENG UI language and active profile indicators

- Added a top-right RU/ENG language selector to the localhost web UI. The
  preference is stored only in browser `localStorage`; no backend setting or
  secret storage is involved.
- Updated the hero/header copy to reflect the current dashboard features:
  multi-profile autopilot, gang auto-accept, energy/chance heists, per-account
  cheapest `+SUC`, and daily reward/contracts claim only at `0` energy.
- Added an Active/Standby badge to every Main/profile card and a stronger visual
  rail/border highlight for the active account.
- Added web UI regression assertions for the language switch, i18n runtime, and
  active badge CSS/JS markers.
- Verified `npm run check`: 46 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `17480`. Safe dashboard check
  returned `accountCount=5`, active account label `4`, legacy jewelry watcher
  alive pid `34228`, and all-profiles watcher not running.

## 2026-07-26 — checkbox controls for gang watcher and active account

- Replaced the Gang auto-accept start/stop/reload buttons in the localhost UI
  with one running checkbox. The checkbox mirrors the gang watcher lock state
  and calls the existing safe start/stop watcher API when changed.
- Replaced Main/profile `Use` buttons with an Active/Standby checkbox on every
  account card. Checking another card switches the single legacy active account;
  unchecking the current active account is rejected client-side so one account
  stays active.
- Kept cookie/proxy update and delete actions as buttons; no secret values are
  displayed or written to logs/wiki.
- Added web UI regression assertions for the gang running checkbox, removal of
  gang watcher buttons, active account checkboxes, and new CSS hooks.
- Verified `npm run check`: 46 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `31004`. Safe dashboard check
  returned `accountCount=5`, active account label `4`, legacy gang watcher
  alive pid `16836`, legacy jewelry watcher alive pid `34228`, and all-profiles
  watcher not running.

## 2026-07-26 — active checkbox no-bounce fix

- Fixed Active/Standby checkbox behavior in the localhost UI. When a Standby
  account card is checked, the UI now stores a pending active account id,
  immediately renders that card as selected, disables active-account toggles
  while the switch is in flight, and applies the selected state locally before a
  slower dashboard refresh returns.
- This prevents the Standby checkbox from visually unchecking during backend or
  proxy-delayed refreshes. If the backend switch fails, the UI reverts and logs
  only a safe error summary.
- Added web UI regression assertions for the pending active account state and
  local active-account apply helper.
- Verified `npm run check`: 46 tests passed.
- Restarted localhost UI on `127.0.0.1:8787`, pid `32712`. Static UI check
  confirmed the pending-active code, active checkbox, Gang checkbox, and CSS
  hooks are served. Lock files present: gang watcher and jewelry watcher.

## 2026-07-26 — independent profile selection and select-all

- Corrected the Active/Standby model: account-card checkboxes now control an
  independent non-secret `automationByAccount` flag instead of the singleton
  legacy `activeProfileId`.
- The multi-profile worker skips Standby accounts before loading their
  credentials or making backend requests. Multiple profiles can remain Active
  simultaneously; accounts without an explicit saved flag default to Active
  for backward compatibility.
- Added one `Select all profiles` action to the account header. Per-account and
  select-all changes render optimistically and settle locally before the slower
  dashboard refresh, preventing checkbox bounce.
- Added settings, worker, and web UI regression tests for independent flags,
  Standby skipping, and the select-all control. Runtime verification and UI
  restart remain pending explicit approval for the local denylisted Node/npm
  commands.

## 2026-07-26 — multi-profile live health check

- Read-only process/lock and safe-log inspection confirmed the multi-profile
  watcher is alive as pid `1312`; both conflicting legacy watchers are stopped.
- The first observed live cycle processed `5/5` enabled accounts with zero
  failures and recorded safe summaries for heists, one gang acceptance,
  per-account upgrades, and two completed daily contract claims.
- A second cycle also processed `5/5` accounts with zero failures. Profiles
  whose heist timer was not due were correctly reported as `not-due`, confirming
  that continued polling does not imply a new energy spend every cycle.
- No live action was started manually during this diagnostic; the inspection
  only observed the already-running worker and safe aggregate logs.

## 2026-07-26 — three-second background autopilot and header activity

- Added an independent `profiles.intervalSeconds=3` setting so the detached
  multi-profile worker polls enabled accounts every three seconds rather than
  inheriting the gang watcher interval.
- Added `jewelry.runIntervalSeconds=3`. After an account reaches the configured
  full `10`-energy budget, live heists inside its batch are spaced by three
  seconds and state is rechecked between requests.
- Added a monochrome header activity console. It renders only strictly parsed,
  whitelisted safe events: heist, cheapest `+SUC`, gang acceptance count, daily
  claim, worker tick/start, and safe error category.
- Added glow states for the running background worker, enabled feature chips,
  live signal cards, checked settings, and active account cards.
- Extended settings, watcher-argument, scheduler-delay, activity-parser, and UI
  regression coverage. Runtime tests and process/UI restart remain pending
  current explicit approval for local Node/npm execution and live-worker
  restart.
- A final read-only lock check found the multi-profile worker stopped. Starting
  the updated worker can immediately execute live backend actions for any
  enabled profile already at the 10-energy threshold, so it was not started
  without explicit current approval.

## 2026-07-26 — profile selection checkbox simplification

- Removed the user-facing Active/Standby status semantics from account cards.
  Every Main/profile card now has one ordinary `Run together` checkbox used only
  to build the simultaneous multi-profile launch group.
- Checked cards retain a monochrome selection highlight, but the UI no longer
  presents one profile as active or another as standby. The persisted
  `automationByAccount` behavior and one-click `Select all profiles` action are
  unchanged.
- Updated the web UI regression markers for the new selection control. Runtime
  tests and UI/worker restart remain pending the previously requested explicit
  approval.
- After explicit backend-restart approval, restarted only the localhost UI
  backend on `127.0.0.1:8787`, pid `6644`. Static served-asset checks confirmed
  `Run together`, no legacy active badge, Select all, the activity header, and
  the three-second run-interval control. The live multi-profile worker was not
  started.

## 2026-07-26 — short-batch diagnosis

- Read-only safe-log inspection explained why one selected profile completed a
  shorter batch. It reached the full 10-energy threshold later, planned five
  two-energy jewelry heists, completed two live requests, then the mandatory
  between-run state check returned `heat-cap`; the batch safely stopped before
  the next request.
- Saved non-secret settings confirmed `energyBudget=10`,
  `requireFullBudget=true`, `runIntervalSeconds=3`, and `heatCap=45`.
- The other four profiles completed their five planned runs because their heat
  remained below the cap until their batches finished. No configuration or live
  action was changed during this diagnostic.

## 2026-07-26 — safe ZIP distribution

- Replaced the stale README with an up-to-date Russian overview covering the
  localhost UI, profile selection, 3-second background poll/run gap, 10-energy
  gating, heat safety, gang auto-accept, per-account `+SUC`, zero-energy daily
  claims, DPAPI storage, installation, and UI launch.
- Sanitized a real-looking proxy IP from a synthetic test fixture by replacing
  it with an RFC TEST-NET address.
- Scanned the 30 allowlisted distribution files without printing candidate
  values; blocking credential/sensitive findings: zero.
- Created
  `looters-farm-bot-safe-2026-07-26.zip`
  with one root folder, README/package manifests, 18 source files, and 9 test
  files. Forbidden archive entries: zero. SHA-256:
  `FD18822AA54537BF19FEFA962BDD3054C3F0A7F29AF4DC5D1E20A0B49B6965ED`.
- Excluded node_modules, `.git`, `.env`, wiki/operational history, credentials,
  DPAPI, HAR, logs, runtime data, and prior ZIP files. Automatic cleanup of the
  safe temporary staging directory was blocked by terminal policy; the staging
  copy contains only the same allowlisted package files.

## 2026-07-26 — four-category per-profile auto-upgrade

- Replaced the single per-profile `+SUC` toggle with four independent
  lowest-price selectors: `+SUC`, `+HEAT`, `+PAY`, and `+REGEN`.
- The worker now receives the selected effect list for each account. It filters
  eligible dependency-safe upgrade nodes to those effects and chooses the
  lowest absolute loot cost; selecting all four therefore chooses the cheapest
  eligible node across all four categories.
- Added backward migration from boolean/`{enabled}` settings to `SUC=true` with
  the other three effects disabled, plus per-effect API validation and
  optimistic no-bounce UI persistence.
- Generalized safe upgrade activity summaries to include only effect, track,
  node, cost, account id, and status. No credentials or raw backend payloads
  were added.
- Updated strategy/settings/worker/UI regression sources and README. Runtime
  Node tests were not executed because the local project rules require a fresh
  explicit approval before running project code.
- Scanned 30 allowlisted distribution files: zero private-key, live
  `PHPSESSID`, or secret-assignment findings. Created
  `looters-farm-bot-safe-2026-07-26-r1.zip`
  with 30 entries and zero forbidden paths. SHA-256:
  `7AA049F56F6D2D05EEA9C579F2983BA50E9F06AEE78E9DD7E443CB143B92EB03`.

## 2026-07-26 — fixed activity rail and effective autopilot status

- Root cause of the Gang checkbox bounce was representational and
  process-related: the checkbox reflected only the standalone gang lock, while
  profiles autopilot intentionally stops that legacy process and performs gang
  requests itself. Starting the standalone gang watcher could therefore stop
  profiles autopilot through the mutual-exclusion guard.
- Added persisted `gang.enabled` with a backward-compatible default of `true`.
  The profiles worker checks it every cycle. While profiles autopilot is live,
  the Gang checkbox now updates this setting inside the existing worker and
  does not start or stop a process. Outside autopilot it retains standalone
  legacy watcher behavior.
- Reworked the status cards for effective state. Gang and Heist show
  `VIA AUTOPILOT`; the first card summarizes the selected farm group and
  backend-readable accounts; auto-upgrade aggregates enabled effect categories
  across selected accounts. A single legacy active account's plan is no longer
  shown as multi-profile engine status.
- Moved `BOT ACTIVITY` to a direct body-level `aside` with fixed desktop
  positioning, bounded scrolling, reserved page gutter, and a fixed bottom-dock
  fallback below 900px.
- Added static regression sources for gang enable persistence, disabling gang
  without stopping other profile modules, effective status rendering, and
  fixed activity CSS. Runtime Node tests and UI/worker restart were not
  executed without fresh explicit approval.
- Scanned 30 allowlisted distribution files with zero sensitive findings and
  created
  `looters-farm-bot-safe-2026-07-26-r2.zip`
  with 30 entries and zero forbidden paths. SHA-256:
  `F717956704724D1EB7A6825175BC46E01BE1FCAFA63D15BC8F7D1EDA4F19FAB4`.

- Final wording/layout refresh was repackaged as
  `looters-farm-bot-safe-2026-07-26-r3.zip`;
  30 entries, zero sensitive findings, zero forbidden paths, SHA-256
  `DEAE4A2C37044B4DC16CA095CEE0DE71D0F72C66051D4E7EA515C17926DA962B`.

- After explicit user approval to refresh the backend, restarted only the
  localhost UI process: old pid `6644` stopped, new pid `32744` serves HTTP 200
  on `127.0.0.1:8787`. Static served-asset checks confirmed the body-level
  activity aside, effective `VIA AUTOPILOT` status, gang delegation logic, and
  fixed activity CSS. Existing live profiles worker pid `35536` remained alive
  and was not restarted.

## 2026-07-26 — centered body and draggable activity window

- Removed the desktop-only reserved right gutter and restored the main `.shell`
  to its original centered `margin: 0 auto` layout.
- Converted `BOT ACTIVITY` from a locked right rail/mobile bottom dock into a
  cursor/touch-draggable viewport window. The header is the drag handle.
- Added localStorage persistence for the non-secret window coordinates and
  viewport clamping on restore, drag completion, resize, and activity-feed
  updates. The panel therefore remains visible during scrolling and cannot be
  left outside the current screen bounds.
- Updated static regression sources and documentation. Runtime Node tests and
  the already-running localhost UI process were not executed/restarted without
  fresh explicit approval; pid `32744` therefore still serves the prior bundle.
- Scanned all 30 allowlisted distribution files without printing candidate
  values: zero blocking secret findings. Created the 30-entry archive
  `looters-farm-bot-safe-2026-07-26-r4.zip`
  with zero forbidden entries; SHA-256
  `FFEFBE08FF2603BD48D1F3D338660FC481CBB097BB1115BA290CD7A626B9DACC`.

## 2026-07-26 — per-profile upgrade checkbox race fix

- Diagnosed the visible `+SUC/+HEAT/+PAY/+REGEN` off/on bounce as an
  out-of-order dashboard response overwriting a just-saved local state.
  Parallel full-file settings writes could also lose one profile's update.
- Added ordered dashboard response application and sticky optimistic
  per-account selections. A clicked value remains rendered until a fresh
  backend snapshot confirms the same value; an older response cannot clear it.
- Serialized localhost settings mutations. Generic settings saves now preserve
  the dedicated `automationByAccount` and `upgradeByAccount` maps, preventing
  unrelated form saves from overwriting per-profile selections.
- Updated regression sources and safe docs. Runtime Node tests and localhost UI
  restart were not performed without fresh explicit approval; pid `32744`
  continues to serve the preceding bundle.
- Scanned 30 allowlisted files without printing candidate values: zero blocking
  secret findings. Created the 30-entry safe archive
  `looters-farm-bot-safe-2026-07-26-r5.zip`
  with zero forbidden entries; SHA-256
  `4B52ECF3C5B142D35DB01489119C7D83D17DFC2DEDF55488BF15301B9FB90BD9`.

## 2026-07-26 — persistent last-launch config snapshot

- Added `%APPDATA%\looters-farm-bot\last-launch-settings.json` as a normalized
  non-secret snapshot written before an actual detached watcher launch.
- Primary `settings.json` remains the normal source of truth. If it is missing
  or malformed, settings loading falls back to the last-launch snapshot, then
  to safe defaults when no valid snapshot exists.
- The snapshot contains only normalized automation settings, including
  per-account run and upgrade selections. Cookies and proxy credentials remain
  exclusively in separate CurrentUser DPAPI storage.
- Static source checks confirmed snapshot normalization, fallback routing,
  pre-spawn persistence, and no credential-loading dependency in the settings
  module. Runtime Node tests and UI/worker restart were not performed without
  fresh explicit approval; running pid `32744` still serves the older bundle.
- Scanned 30 allowlisted files without printing candidate values: zero blocking
  secret findings. Created the 30-entry safe archive
  `looters-farm-bot-safe-2026-07-26-r6.zip`
  with zero forbidden entries; SHA-256
  `34FF2511401DF431672CC2A2959DC7176F1F9A47875820131080C63B5A143CBF`.

## 2026-07-26 — localhost UI backend refresh

- With fresh explicit user approval, syntax-checked `webUi.js`, `settings.js`,
  and `processManager.js`, then stopped old UI pid `32744` and started new UI
  pid `15484` on `127.0.0.1:8787`.
- `/`, `/app.js`, and `/app.css` returned HTTP `200`. Served assets confirm the
  centered body, draggable activity window, and ordered checkbox reconciliation
  bundle.
- No gameplay worker was started or stopped. Safe post-check found an existing
  all-profiles lock pointing to non-running pid `35784`; the autopilot is
  currently stopped with a stale lock.

## 2026-07-26 — one multi-profile execution mode

- Removed the `Single-active watchers` card and all Heist legacy
  start/stop/reload buttons from the localhost UI.
- Replaced execution controls with one multi-profile mode:
  `Start selected`, `Start all`, and `Stop autopilot`. `Start all` persists all
  account selections before starting the same profiles worker.
- Gang auto-accept now saves only its module-enabled setting. It cannot launch
  a standalone gang process when profiles autopilot is stopped. Heist scheduler
  is configuration-only and is reread by the common worker.
- Restricted localhost watcher mutation routes to `profiles` only. CLI legacy
  commands remain available for compatibility but are absent from the main UI.
- Added static regression coverage for the missing legacy panel/routes and the
  selected/all execution paths. Runtime Node tests and UI restart were not
  performed without fresh explicit approval; pid `15484` still serves the
  preceding bundle.
- Scanned 30 allowlisted distribution files without printing candidate values:
  zero blocking secret findings. Created the 30-entry safe archive
  `looters-farm-bot-safe-2026-07-26-r7.zip`
  with zero forbidden entries; SHA-256
  `19259D9FEE269D7C1E7545E351B2B20D643519E8D8960FE99F66D7A15BFAB1B5`.

## 2026-07-26 — consolidated autopilot scheduler

- Removed the redundant `Multi-profile autopilot` settings card from the
  localhost UI. The `Start selected`, `Start all`, and `Stop autopilot`
  controls now live in the renamed `Autopilot scheduler` card beside the
  energy, chance, heat, daily, and run-interval settings.
- The runtime architecture is unchanged: one profiles worker handles the
  checked accounts or all accounts and applies enabled Gang, daily claim, and
  per-profile upgrade modules.
- Added a visually separated scheduler action footer and updated RU/ENG
  wording, README instructions, and static regression assertions. Source
  checks confirm that the only exposed watcher target is `profiles`; no
  legacy single-active or restart controls were reintroduced.
- Runtime Node tests and the localhost UI restart were not performed without
  fresh explicit approval. Running UI pid `15484` therefore still serves the
  preceding bundle.
- Scanned the 30 allowlisted distribution files without printing candidate
  values: zero blocking secret findings. Created the 30-entry safe archive
  `looters-farm-bot-safe-2026-07-26-r8.zip`
  with zero forbidden entries; SHA-256
  `FCA4E3518DF715A762F52307F8131167FEAD2284B734CFBE5F3ED6FA286BD188`.

## 2026-07-26 — consolidated scheduler UI refresh

- With fresh explicit user approval, syntax-checked `webUi.js`, `settings.js`,
  and `processManager.js`, then stopped old localhost UI pid `15484` and
  started pid `21916` on `127.0.0.1:8787`.
- `/`, `/app.js`, and `/app.css` returned HTTP `200`. Served assets confirm the
  renamed RU/ENG Autopilot scheduler, integrated start-selected/start-all/stop
  controls, scheduler action styling, and absence of the removed separate
  Multi-profile heading.
- No gameplay autopilot or legacy watcher was started by this UI refresh.

## 2026-07-26 — compact collapsible status header

- Diagnosed the large empty area in the Gang card as default CSS Grid stretch
  against the taller Autopilot scheduler card. Added a dedicated settings-grid
  alignment so both cards keep equal width but natural independent heights.
- Replaced the always-visible header status row with a default-collapsed
  RU/ENG status drawer controlled by `Show/Hide status`. The button exposes
  `aria-expanded`, the panel exposes `aria-hidden`, and reduced-motion users do
  not receive the drawer transition.
- Status cards now use a five-column square desktop grid, denser status
  typography, and responsive three/two/one-column fallbacks.
- Updated static regression assertions and README. Runtime Node tests and the
  localhost UI restart were not performed without fresh explicit approval;
  pid `21916` still serves the preceding bundle.
- Scanned 30 allowlisted distribution files without printing candidate values:
  zero blocking secret findings. Created the 30-entry safe archive
  `looters-farm-bot-safe-2026-07-26-r9.zip`
  with zero forbidden entries; SHA-256
  `02B5F276E0ED10E523118F0B1D9E404A3CE96FBD4E56EB49D49323C1FA099FF6`.

## 2026-07-26 — private GitHub publication preparation

- Added a strict `.gitignore` for dependency, environment, archive, HAR, DPAPI,
  log, key, credential, token, cookie, and wallet artifacts.
- Added least-privilege GitHub Actions CI for Node 22 using `npm ci` and
  `npm run check` on push and pull requests.
- Scanned all 36 intended repository files for private keys, live session
  values, bearer/JWT/API/GitHub/cloud tokens, hidden/bidi controls, and prompt
  injection phrases. Four credential-like proxy literals were confined to
  tests and replaced mechanically with explicit non-production placeholders;
  the blocking rescan is clean.
- Built the 32-entry allowlist archive
  `looters-farm-bot-safe-2026-07-26-r10.zip`.
  It excludes wiki/operational history, credentials, runtime data,
  dependencies, Git metadata, and prior archives; forbidden entries: zero;
  SHA-256
  `92DDB105BCAAA4EC189ED7602746752FBAABBE71F3005E4745C21C4A269F1DBD`.

## 2026-07-26 — private GitHub publication and CI

- Initialized `main`, committed only the 36 reviewed project files, created
  private repository `https://github.com/sleepless-developer/looters-farm-bot`,
  and pushed via HTTPS without force-push.
- The first isolated GitHub Actions run exposed outdated test expectations
  after the cheapest-price upgrade change and proxy-fixture sanitization, plus
  a Linux test dependency on Windows `APPDATA`. Production logic was unchanged:
  proxy expectations now use explicit placeholders, cheapest `+SUC` tests
  match the current absolute-price planner, and Web UI tests use a temporary
  isolated settings directory.
- The follow-up CI run passed. Updated workflow dependencies to the current
  Node 24-based `actions/checkout@v5` and `actions/setup-node@v6` while the
  project test matrix remains Node 22.
- Re-ran intended-file and staged-content scans: no blocking private key,
  live session, bearer/JWT/API/GitHub/cloud token, or real proxy credential
  patterns.
- Built final 32-entry allowlist archive
  `looters-farm-bot-safe-2026-07-26-r11.zip`;
  forbidden entries: zero; SHA-256
  `E97D28092766D6C35033C940B20FB842E810D6FB08E3E4F674149D1D6CFB0A8F`.

## 2026-10-24 — English-only repository

- Translated the README and wiki navigation to English. Removed the Russian UI
  dictionary, language controls, and saved-language dependency; all maintained
  interface text now uses English. Terminal confirmations use English answers.
- Added contributor language rules and a check-suite guard against Cyrillic text
  and private Windows user paths. UI regression tests cover English message
  keys, interpolation, generated JavaScript syntax, and old language preferences.
- Redacted private absolute machine paths from earlier documentation entries;
  historical events and archive filenames remain intact. This is a safety
  redaction, not a rewrite of Git commit history.
- Worked from the published baseline in an isolated checkout, preserving all
  unrelated uncommitted feature work in the original checkout. No game actions,
  account-credential reads, dependency installs, or worker restarts occurred.
- With explicit permission, ran `npm run check` using existing dependencies and
  isolated temporary settings: all 56 tests passed. Existing CI automatically
  includes the new tests. The repository description is already English, and
  there are no releases, open issues, open PRs, or hosted wiki pages to translate.
