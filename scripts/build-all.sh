#!/usr/bin/env bash
# Rebuild all dashboards.
#
# Default: read the newest snapshot under $DATA_ROOT/snapshots/.
# VIBESTATS_LIVE=1: read ~/.claude, ~/.codex, ~/.gemini directly — no rsync
# first, so the rebuild reflects sessions from minutes ago.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CODE_ROOT="$(cd "$DIR/.." && pwd)"

if [ -n "${VIBESTATS_DATA_DIR:-}" ]; then
  DATA_ROOT="$VIBESTATS_DATA_DIR"
elif [ -f "$CODE_ROOT/pricing.json" ]; then
  DATA_ROOT="$CODE_ROOT"
else
  DATA_ROOT="$HOME/.vibestats"
fi

# Ask the same resolver the builders use whether a source is present, so the
# gates below work identically in snapshot and live mode.
has_source() { node "$DIR/lib/sources.js" has "$1" >/dev/null 2>&1; }

# One tool's parser blowing up must not abort the run. It used to: a pricing.json
# missing a key crashed the gemini builder under `set -e`, so the combined
# dashboard was never rewritten and kept serving whatever the last successful
# build produced — months old, with nothing on screen saying so.
FAILED=""
try_build() {
  local script="$1" label="$2"
  if ! node "$DIR/$script"; then
    echo "!! $label dashboard failed to build — continuing with the rest." >&2
    FAILED="$FAILED $label"
  fi
  echo
}

echo "Building from: $(node "$DIR/lib/sources.js" label)"

# Snapshot mode gets its cwd-manifest from snapshot.sh. Live mode has no
# snapshot dir to write into, so build the manifest here (git remote lookups
# over the live project dirs — a few seconds).
if [ "${VIBESTATS_LIVE:-}" = "1" ]; then
  node "$DIR/lib/build-cwd-manifest.js" --live
fi

try_build build-dashboard.js claude
try_build build-codex-dashboard.js codex

if has_source claude-web; then
  try_build build-claude-web-dashboard.js claude-web
fi

if has_source gemini-tmp || has_source gemini-history; then
  try_build build-gemini-dashboard.js gemini
fi

if has_source goose; then
  try_build build-goose-dashboard.js goose
fi

if has_source cline; then
  try_build build-cline-dashboard.js cline
fi

# The combined view is the one the app opens — a failure here is fatal.
node "$DIR/build-combined-dashboard.js"
echo
if [ -n "$FAILED" ]; then
  echo "Built with failures:$FAILED (see errors above). Other dashboards are current."
fi
echo "Done. Dashboards written to $DATA_ROOT/"
echo "  Open via: vibestats open  (or open $DATA_ROOT/combined-dashboard.html)"
echo "  Serve:    vibestats serve"
