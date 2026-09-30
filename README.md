# vibestats

Local dashboard for your AI coding tool usage: Claude Code + Codex + optional claude.ai web chats. GitHub-style heatmap, per-day token + cost breakdown, "what would this have cost on API" vs subscription multiple.

**Privacy**: vibestats is 100% local. Zero outbound network calls except `vibestats fetch-web` and `vibestats prices update` (both opt-in). No telemetry, no auto-update check, no analytics. Your snapshots, dashboards, and configs live in `~/.vibestats/` at 0700/0600 perms.

**Data sensitivity**: vibestats reads full Claude Code / Codex transcripts. Those files contain everything you typed into the tools — including any secrets you pasted (API keys, `.env` files, customer data). The generated HTML dashboards embed raw project names + timestamps. Do **not** commit `~/.vibestats/snapshots/` to git or post the dashboards on the public internet without running `vibestats redact` first (coming in v0.2).

## Install

Pick whichever:

```bash
# npx (no install)
npx @trebeljahr/vibestats

# npm global
npm install -g @trebeljahr/vibestats
vibestats

# Homebrew (macOS, Linux)
brew tap trebeljahr/tap
brew install vibestats
vibestats

# Desktop app (DMG / MSI / AppImage)
# https://github.com/trebeljahr/vibestats/releases/latest
```

Or clone the repo for dev:

```bash
git clone https://github.com/trebeljahr/vibestats
cd vibestats
./install.sh                       # snapshot + build
./scripts/open.sh                  # open combined dashboard
# or  ./scripts/serve.sh           # localhost server
# or  npm run tauri:dev            # desktop app dev mode
```

## What it reads

- `~/.claude/projects/` + `~/.claude/projects-archive/` — Claude Code transcripts. Archive is included because the CLI auto-archives older project dirs and the built-in `/stats` widget can't see them.
- `~/.codex/archived_sessions/` — Codex rollout jsonl. The 3GB `logs_2.sqlite` debug log is skipped on purpose.
- `~/.gemini/antigravity/conversations/` — Gemini Antigravity protobuf (snapshotted for safekeeping; parser not yet written).

Missing dirs are silently skipped, so this works whether you use one tool or all of them.

## What it computes

- **Active days, current/longest streak, sessions, messages, tokens** — per filtered range
- **API cost (would-be)** — what your usage would have cost at pay-as-you-go rates
- **Subscription paid** — prorated from your subscription start date through the last active day in the range
- **Value multiple** — API cost ÷ subscription paid

## Navigating time

The **Range** control picks a window size (month, 30/90/180/365 days, calendar year, or all time); the **‹ ›** pager next to it steps that window backwards and forwards, one whole window at a time. Left/right arrow keys do the same.

Paging past your first day of data is allowed on purpose — an empty year is a real answer to "was I using this back then?". Every window draws its full span, so an empty stretch shows as an empty grid rather than a missing chart, and the stats read zero rather than falling back to totals.

## Config

Two files seeded from `*.example.json` on first run:

- **`pricing.json`** — model prices per million tokens (Anthropic + OpenAI), plus your subscription tier, monthly cost, and start date. Edit these to match reality.
- **`project-aliases.json`** — merge renamed/duplicate projects into one canonical row. Add entries when you rename a project mid-development so its old and new dirs show up as one.

### Keeping prices fresh

The Claude/OpenAI model lineup churns. Rather than chasing every price tweak by hand, you can pull the latest rates from [LiteLLM's model_prices_and_context_window.json](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) — a daily-updated, community-maintained price table covering ~2700 models:

```bash
vibestats prices update    # fetch + cache LiteLLM pricing
vibestats prices show      # list cached rates for models you've actually used
```

What this does:

- Fetches the LiteLLM JSON over HTTPS (one GET; no auth needed).
- Filters down to the Claude (`anthropic` provider, `claude-*` names) and OpenAI (`openai` provider, `gpt-*` / `o*` names) families vibestats actually meters — currently ~21 Claude + ~84 OpenAI models — and converts per-token prices to the `$/MTok` shape `pricing.json` uses.
- Writes the result to `pricing-cache.json` in your data dir, at `0600` perms. Safety: refuses to write if the response has fewer than 100 entries (guards against a truncated download).
- Builders merge `pricing-cache.json` on top of `pricing.json` if the cache is **less than 30 days old**. Older than that, the cache is ignored and you see a "re-run `vibestats prices update`" hint at build time. **Your subscription block in `pricing.json` is never touched** — only per-model rates are layered in.

This is opt-in: vibestats does **not** auto-fetch. It only hits the network when you explicitly run `vibestats prices update` (or `vibestats fetch-web` for claude.ai chats). Everything else is local-only.

## Optional: claude.ai web chats

The web chat history isn't on disk locally (Claude Desktop is a web wrapper). To include those chats:

```bash
# 1. Open claude.ai logged in
# 2. DevTools → Application → Cookies → claude.ai → copy the sessionKey value
export CLAUDE_SESSION_KEY=sk-ant-sid01-...
# or write to ~/.claude-stats-config.json:  { "session_key": "sk-ant-sid01-..." }

node scripts/fetch-claude-web.js          # downloads conversations to snapshots/<date>/claude-web/
./scripts/build-all.sh                    # rebuilds with web chats included
```

Caveat: the web API doesn't return per-message token counts. Web-chat cost is estimated from message count × heuristic (1200 input + 600 output tokens per message). Tweak the constants in `build-claude-web-dashboard.js` if your conversation style is different.

## Output files

- `dashboard.html` — Claude Code only
- `codex-dashboard.html` — Codex only
- `claude-web-dashboard.html` — claude.ai web chats only (if fetched)
- `combined-dashboard.html` — all of the above merged

All four are standalone HTML files — data is inlined as JSON. Open in a browser, scp to a server, host on Vercel/Netlify, whatever. No backend.

## Deploying

Static files. Pick your favorite host:

```bash
# Vercel
npx vercel --prod

# Netlify
npx netlify deploy --prod --dir=.

# Or just push the HTMLs anywhere
```

The dashboard contains your raw usage metadata (project names, timestamps, token counts) — if you're putting it on the public internet, decide whether that's something you want exposed.

## Known gaps

- Gemini conversations are protobuf without a bundled `.proto` definition. Files captured for future parsing.
- Server-tool charges (web search at $10/1k, code execution runtime) are excluded — not exposed cleanly in the jsonl.
- Claude fast-mode (6× premium on Opus 4.6/4.7) isn't detectable from jsonl. Real Claude cost is likely higher than reported.

## Refresh

Dashboards are static HTML built from a point-in-time read of your transcripts. Nothing re-reads your data while a dashboard is open, so the header always states what the page was built from and flags it once it is more than a day old.

Two ways to rebuild:

```bash
vibestats live                            # read ~/.claude, ~/.codex, ~/.gemini in place, rebuild, open
vibestats all                             # snapshot (rsync, ~2GB) + rebuild + open
```

`live` is the fast path — seconds, no copy — and is what you want when the dashboard looks out of date. `all` additionally archives a dated snapshot, which is what preserves history and what `redact` operates on.

Piecewise:

```bash
./scripts/snapshot.sh                     # rsync ~/.claude, ~/.codex, ~/.gemini into snapshots/<today>/
./scripts/build-all.sh                    # rebuild HTMLs from latest snapshot
VIBESTATS_LIVE=1 ./scripts/build-all.sh   # rebuild HTMLs straight from the live dirs
```

Snapshots are dated dirs; nothing is destructive. Commit the repo if you want historical snapshots tracked.

`vibestats fetch-web` (claude.ai chats) writes into the newest snapshot, so that one tool is snapshot-only — in live mode its data comes from the last snapshot taken.

### Dev preview

`pnpm dev` serves the dashboard from your **live** data (the dev server runs the live build on startup; the Refresh button re-runs it). Set `VIBESTATS_FIXTURE=1` to use the checked-in fictional `dev/dashboard-preview/sample-payload.json` instead — useful for screenshots and for working on the UI with no local history.

## Keep personal history local

New installations use `~/.vibestats`; `VIBESTATS_DATA_DIR` selects another private directory. Existing clones with `pricing.json` keep their data in place. Source discovery uses the current user's home directory. Missing tool installations are skipped during snapshots. Snapshot refreshes preserve files that disappeared from the source.

Run `npm run privacy:check` before committing or packaging source. This checks tracked file paths and selected private-path patterns; it is not a complete secret scanner. Generated state, including `pending-merges.json`, must remain ignored. Never force-add usage files or push old branches containing them.

Public demos use fictional data. Redacted dashboards still contain activity and cost information: review each file before sharing. Never deploy the repository or data directory as a website.

For a source clone, enable the push guard with `git config core.hooksPath .githooks`. It checks the history being pushed for known private paths. Keep any pre-existing history containing personal data private; do not merge it into a clean public repository.
