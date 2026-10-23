# Codebase map

## 2026-10-24 English-only repository

- `AGENTS.md` defines English-only GitHub content and safe translation checks.
- `test/language.test.js` guards maintained text against Cyrillic content and
  private Windows user paths; it is included in the existing check suite.
- `test/webUi.test.js` checks English HTML and client messages, message-key
  coverage, variable interpolation, generated JavaScript syntax, and independence
  from stored language preferences.

## 2026-07-26 additions

- `.github/workflows/ci.yml` — least-privilege Node 22 CI for push and pull
  requests; installs strictly from the lockfile and runs the project check
  suite without repository secrets.
- `src/consoleUi.js` — interactive terminal menu for safe status, watcher
  settings, DPAPI cookie update/clear, and watcher start/stop/restart.
- `src/settings.js` — non-secret settings persisted to
  `%APPDATA%\looters-farm-bot\settings.json`, including independent
  `automationByAccount`, four-effect `upgradeByAccount` selections,
  `gang.enabled`, the independent multi-profile `3`-second poll, and the
  `3`-second between-run delay. It also stores a normalized non-secret
  `last-launch-settings.json` fallback and uses it when the primary settings
  file is missing or malformed.
- `src/processManager.js` — starts/stops detached watcher processes using saved
  settings and existing lock files, snapshots the normalized config before an
  actual launch, and enforces mutual exclusion between legacy single-active
  watchers and the all-profiles watcher.
- `src/webUi.js` — localhost-only web dashboard with safe status, non-secret
  settings, DPAPI cookie update/clear, watcher controls, four per-profile
  lowest-price upgrade selectors, effective multi-profile engine states, glow
  indicators, and a draggable strict-whitelist safe activity window. Its
  non-secret position is stored in browser localStorage and clamped to the
  current viewport. Per-account setting mutations are serialized server-side;
  ordered dashboard snapshots reconcile sticky optimistic checkbox state. The
  main UI exposes only the profiles worker. Its start-checked, start-all, and
  stop controls are consolidated into the `Autopilot scheduler` settings card;
  there is no separate `Multi-profile autopilot` card. Legacy single-account
  process controls and HTTP watcher routes are not exposed. Header status cards
  live in a default-collapsed English status drawer, use a five-column square desktop
  grid with responsive fallbacks, and the Gang/scheduler settings grid aligns
  cards to their natural heights instead of stretching the shorter card.

- `src/cli.js` — command-line interface.
- `src/apiClient.js` — JSON-only backend client for
  `lootersnft.xyz/api/game.php`; uses `undici` `fetch` and `ProxyAgent`
  together so per-profile proxy requests work consistently.
- `src/vault.js` — Windows DPAPI wrapper for the session cookie plus named
  cookie/proxy profiles and safe per-account credential loading.
- `src/strategy.js` — target selection (`stable-ev` and
  `lowest-safe-chance`), priority upgrade planner, cheapest `+SUC` upgrade
  planner, and action decision.
- `src/constants.js` — backend-derived upgrade tables and safe action allowlists.
- `src/har.js` — redacted HAR summarizer.
- `src/gang.js` — safe gang request listing and auto-accept.
- `src/daily.js` — daily reward/contracts claimer. It claims streak reward and
  completed contracts only after verifying `me.player.energy === 0`, using safe
  backend action allowlists.
- `src/jewelry.js` — legacy-named heist scheduler. Saved settings and UI expose
  dynamic `lowest-safe-chance` and `stable-ev` target modes; old saved `fixed`
  settings are migrated back to `lowest-safe-chance`. The scheduler also
  supports an optional lowest-price selected-effect auto-upgrade sweep,
  optional daily claim
  after/while energy is zero, and a configurable delay between live heists
  inside a batch (default `3` seconds).
- `src/lock.js` — DPAPI-adjacent appdata lock files for long-running workers.
- `src/notify.js` — local desktop notifications for accepted gang requests.
- `src/worker.js` — single-account loop, lock file, safe action execution.
- `src/profilesWorker.js` — multi-profile autopilot loop. It processes every
  account whose independent selection checkbox is enabled, skips unchecked
  accounts before credential loading, and keeps isolated cookie/proxy credentials,
  per-account auto-upgrade settings, the effective `gang.enabled` module, and
  safe aggregate logging.

Data flow:

1. Cookie is saved to `%APPDATA%\looters-farm-bot\session-cookie.dpapi`, or to
   named profile DPAPI files under `%APPDATA%\looters-farm-bot\profiles`.
2. Legacy worker loads the active profile cookie/proxy and calls
   `GET action=me/contracts/factories`. The all-profiles worker loads each
   account by id and creates one API client per account.
3. Optional gang auto-accept reads `GET gang` and sends `request_respond` only
   when explicitly enabled. In multi-profile mode it runs inside the profiles
   worker; the standalone `gang watch` remains a mutually exclusive legacy
   single-account mode.
4. Daily claim guard can claim streak/contracts only when a profile has
   `energy=0`.
5. Strategy chooses one action: wait, bail, upgrade, or heist. The heist
   scheduler can optionally run the cheapest eligible node among selected
   `SUC/HEAT/PAY/REGEN` effects before/after heist ticks, then selects the
   lowest live backend chance at or above the configured threshold.
6. Live POSTs are only sent with `--live`; dry-run logs the intended safe action.
