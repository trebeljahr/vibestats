# Changelog

All notable changes to vibestats are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Live mode** — `vibestats live` (and `vibestats build --live` / `VIBESTATS_LIVE=1`) rebuilds dashboards by reading `~/.claude`, `~/.codex`, `~/.gemini` and the Cline/Goose dirs in place, skipping the ~2GB snapshot rsync. Seconds instead of minutes, and the result includes sessions from moments ago.
- **Time pager** — the heatmap window (month / N days / calendar year) can be stepped backwards and forwards with ‹ › or the arrow keys, including past the first day of data. Windows render their whole span, so an empty period shows as an empty grid with zeroed stats instead of no chart.
- **Staleness badge** — the dashboard header now reports whether it was built from a snapshot or live dirs, and shows an "N days old — refresh" badge when the build is more than a day old. The combined view also names any per-tool aggregate lagging behind the others.

### Changed

- **`pnpm dev` shows real data.** The dev preview fetched a checked-in fixture, which silently froze it at the day the fixture was generated. It now loads a live-built payload from the dev server; `VIBESTATS_FIXTURE=1` restores the fixture for screenshots.
- Refresh button rebuilds from the dev server when running under vite (it already invoked the snapshot+build pipeline in the desktop app).

### Fixed

- Wide heatmaps (a full year is 53 columns) scroll horizontally instead of being clipped; the weekday labels stay pinned while they do.
- Zero values render as `0` / `$0` rather than `+0`, `−0` and `$0.0000`.

## [0.1.0] - 2026-05-30

First public release. CLI + Tauri desktop app + npm package + Homebrew formula.

### Added

- **Claude Code parser** — reads `~/.claude/projects/` + `~/.claude/projects-archive/` JSONL transcripts.
- **Codex parser** — reads `~/.codex/archived_sessions/` rollout JSONL; collapses worktrees under base project.
- **Gemini CLI parser** — reads `~/.gemini/tmp` + history (sessions / messages / days; no token counts available upstream).
- **Goose CLI parser** — `node:sqlite` reader for `sessions.db`; tries `GOOSE_PATH_ROOT`, macOS Block dir, Linux `~/.local/share` in turn. Skips silently on Node <22.
- **Cline-family parser** — reads `api_req_started` events from Cline / Roo / Kilo task dirs (VS Code + Cursor `globalStorage`). Normalizes dated model suffixes; tracks pricing-computed and self-reported cost.
- **claude.ai web parser** — `vibestats fetch-web` pulls chat conversations via authenticated `sessionKey`; combined dashboard ingests when present.
- **Dashboard suite** — Claude / Codex / Gemini / Goose / Cline / claude-web / combined HTML dashboards with GitHub-style heatmap, per-day breakdown, top projects, model breakdown.
- **Heatmap interactions** — click a day cell to open a per-day detail modal; min 6 months back; month/day labels with first-Monday-of-month suppression.
- **Range filter + color-by selector** — dashboard v2.
- **Subscription value computation** — API would-be cost vs prorated subscription paid, value multiple.
- **`prices` subcommand** — opt-in LiteLLM price cache (`update`, `show`); writes `pricing-cache.json` (0600, 30-day freshness). Builders layer cache on `pricing.json` via `scripts/lib/pricing.js`.
- **`redact` subcommand** — hashes project names + optional date coarsening; `--check` scans for secret patterns (PAT / `sk-` / `AIza` / `AKIA` / JWT).
- **`merges` subcommand** — Levenshtein-based pending-merges detection; CLI `list`/`accept`/`reject`/`clear`; dashboard banner surfaces count.
- **Project aliases** — manual + auto-merge via `git remote` URL match. Detects project renames (e.g. `extinction` → `mesozoic`) by shared remote.
- **Auto-detect subscription tier** from snapshot token volume + model mix. Idempotent (skips when `pricing.json` was user-edited).
- **`homePrefix` auto-detect** from `os.homedir`; empty-state dashboard for fresh installs.
- **Tauri 2 desktop app** — bundles CLI + scripts as resources; tray menu; Settings panel (read/write `pricing.json` round-trip with validation); `prepare_dashboard` rebuild on save.
- **First-run banner** for auto-detected pricing (7-day dismiss).
- **`pricing.example.json`** ships with `_autoDetected: true` so detect-subscription runs on first install.
- **Hatchkit-style release pipeline** — `release-prep.mjs`, `release-bump.mjs`, GitHub Actions cross-platform Tauri build + npm publish on tag push.
- **Icon set generator** — `scripts/build-icons.mjs` regenerates platform icons from `icons/icon.svg`.
- **Homebrew formula** — `Formula/vibestats.rb` for `brew install trebeljahr/tap/vibestats`.
- **Marketing site + sanitized demo + fumadocs docs** under `site/`.

### Changed

- Renamed project to **vibestats** from prior working title.
- Combined dashboard sums worktrees across tools.
- `snapshot.sh` accepts `VIBESTATS_DATA_DIR` env override; tries multiple known data roots per tool.
- `serve.sh` binds `127.0.0.1` by default (was `0.0.0.0`).
- Dashboard widens Tauri `assetProtocol` scope to cover `$HOME/**` and `/tmp/**` for env-overridden `DATA_ROOT`.

### Fixed

- Banner inline `display:flex` overrode HTML `hidden` attr (banners always visible).
- `pricing.example.json` was missing `_autoDetected: true`, so detect-subscription was skipped on first install.
- `release-bump.mjs` ESM import path + only stages existing version files.
- Heatmap month labels spilling back into prior month (only label first Monday of month, `date ≤ 7`).
- Heatmap leading-month rendering — snap start to 1st of month so it renders full width.

### Security

- **File perms** — data dir `0700`, config files `0600`.
- **CSP** in Tauri (`default-src 'self' asset: https://asset.localhost; …`) + scoped `assetProtocol`.
- **`release-prep.mjs` tarball audit** — blocks forbidden patterns (snapshots, dashboards, real `pricing.json`, project-aliases, `.git/`, etc.) from being shipped to npm.
- **`.npmignore`** excludes user data + iconset intermediates from the npm tarball.
- **Git history rewrite** via `git filter-repo` to drop committed transcripts + API keys; `.gitignore` updated; user-data paths untracked.

[Unreleased]: https://github.com/trebeljahr/vibestats/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/trebeljahr/vibestats/releases/tag/v0.1.0
