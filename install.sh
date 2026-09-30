#!/usr/bin/env bash
# One-shot bootstrap: take a snapshot of your local AI-tool data, build
# dashboards, print the open command. Safe to re-run any time.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

command -v node >/dev/null || { echo "node not found. Install Node 18+ first."; exit 1; }
command -v rsync >/dev/null || { echo "rsync not found. macOS ships with it; Linux: apt install rsync."; exit 1; }

# Seed configs from examples on first run so the user gets reasonable defaults
[ -f "$DIR/pricing.json" ]         || cp "$DIR/pricing.example.json"         "$DIR/pricing.json"
[ -f "$DIR/project-aliases.json" ] || cp "$DIR/project-aliases.example.json" "$DIR/project-aliases.json"

# Snapshot whatever exists in your home (~/.claude, ~/.codex, ~/.gemini). Missing dirs are skipped.
"$DIR/scripts/snapshot.sh"
echo

# Build dashboards
"$DIR/scripts/build-all.sh"
echo

cat <<EOF

================================================================
Setup complete.

  Open dashboard:   ./scripts/open.sh
  Or serve locally: ./scripts/serve.sh   (random high port, won't clobber dev servers)

  Edit pricing.json to match your subscription tier and start date.
  Edit project-aliases.json to merge renamed projects into one row.

  Refresh anytime: ./install.sh   (or ./scripts/snapshot.sh + ./scripts/build-all.sh)
================================================================
EOF
