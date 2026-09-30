#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CODE_ROOT="$(cd "$DIR/.." && pwd)"
if [ -n "${VIBESTATS_DATA_DIR:-}" ]; then DATA_ROOT="$VIBESTATS_DATA_DIR"
elif [ -f "$CODE_ROOT/pricing.json" ]; then DATA_ROOT="$CODE_ROOT"
else DATA_ROOT="$HOME/.vibestats"; fi
open "$DATA_ROOT/combined-dashboard.html"
