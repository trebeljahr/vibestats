# Contributing to vibestats

Thanks for helping. Bug reports, parser requests for other AI coding tools and pull requests are all welcome.

## Never share real transcripts

Transcripts hold everything typed into a tool, including pasted secrets. Do not attach real transcripts, snapshots, dashboards, `pricing.json` or `project-aliases.json` to an issue or a pull request. When a parser needs a sample, write a short fictional one by hand. Use paths such as `/home/demo/projects/example` or `/tmp/test-myproj`, as the files in [`fixtures/`](fixtures/) do.

## Set up

```bash
git clone https://github.com/trebeljahr/vibestats
cd vibestats
pnpm install
git config core.hooksPath .githooks       # history privacy check before every push
```

Useful commands:

```bash
pnpm dev                                  # dashboard dev server (VIBESTATS_FIXTURE=1 for fictional data)
pnpm privacy:check                        # tracked files must not contain private paths

# Build every dashboard from a generated fictional history instead of your own:
node scripts/marketing/demo-history.mjs /tmp/vs-demo
HOME=/home/demo VIBESTATS_DATA_DIR=/tmp/vs-demo bash scripts/build-all.sh
open /tmp/vs-demo/combined-dashboard.html   # xdg-open on Linux
pnpm demo:build                           # rebuild site/public/demo/index.html from that history
pnpm tauri:dev                            # desktop app (needs Rust)
```

## Before you open a pull request

CI runs these checks. Run the ones your change touches:

```bash
node scripts/privacy-check.js
RELEASE_SKIP_NPM_CHECK=1 RELEASE_SKIP_CHANGELOG_CHECK=1 node scripts/release-prep.mjs
VIBESTATS_DATA_DIR=fixtures/snapshot-fixture node scripts/redact.js --check
(cd src-tauri && cargo clippy -- -D warnings)   # only for src-tauri/ changes
```

Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Adding a parser for another tool

Each tool has one builder in `scripts/build-<tool>-dashboard.js` that writes `data/<tool>-agg.json`. `scripts/build-combined-dashboard.js` merges those files. Add the tool's source dirs to `scripts/snapshot.sh` and `scripts/lib/sources.js` so both snapshot and live mode find them. Missing dirs must be skipped without an error.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
