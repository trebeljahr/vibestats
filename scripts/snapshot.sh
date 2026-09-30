#!/usr/bin/env bash
# Snapshot ~/.claude/projects + statsig into a dated dir under snapshots/.
# Preserves mtimes — those are the signal for streaks/heatmap.
set -euo pipefail
umask 077

# DATA_ROOT resolution mirrors scripts/lib/paths.js:
#   1. $VIBESTATS_DATA_DIR if set
#   2. Repo root if pricing.json present there (local dev clone)
#   3. ~/.vibestats/ (npm/Homebrew install)
CODE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${VIBESTATS_DATA_DIR:-}" ]; then
  DATA_ROOT="$VIBESTATS_DATA_DIR"
elif [ -f "$CODE_ROOT/pricing.json" ]; then
  DATA_ROOT="$CODE_ROOT"
else
  DATA_ROOT="$HOME/.vibestats"
fi
mkdir -p "$DATA_ROOT"
DATE="$(date +%Y-%m-%d)"
DEST="$DATA_ROOT/snapshots/$DATE"

mkdir -p "$DEST"

echo "Snapshotting to $DEST"
# Tool installations are optional. Preserve earlier files when a source disappears.
for kind in projects projects-archive statsig backups sessions; do
  if [ -d "$HOME/.claude/$kind" ]; then
    mkdir -p "$DEST/$kind"
    rsync -a "$HOME/.claude/$kind/" "$DEST/$kind/"
  fi
done

# Codex archived sessions (jsonl rollouts). Skip logs_2.sqlite (3GB debug telemetry).
if [ -d ~/.codex/archived_sessions ]; then
  rsync -a ~/.codex/archived_sessions/ "$DEST/codex-sessions/"
fi

# Gemini Antigravity conversations (protobuf .pb files — parser TODO).
if [ -d ~/.gemini/antigravity/conversations ]; then
  rsync -a ~/.gemini/antigravity/conversations/ "$DEST/gemini-antigravity-conversations/"
fi
# Gemini CLI sessions: tmp/ has current chats + logs, history/ has older sessions.
# Both store .project_root → absolute path mapping per project folder.
if [ -d ~/.gemini/tmp ]; then
  rsync -a ~/.gemini/tmp/ "$DEST/gemini-tmp/"
fi
if [ -d ~/.gemini/history ]; then
  rsync -a ~/.gemini/history/ "$DEST/gemini-history/"
fi

# Goose CLI sessions: sqlite db under platform-specific data dir. Try
# $GOOSE_PATH_ROOT first, then known macOS + Linux defaults.
GOOSE_SRC=""
if [ -n "${GOOSE_PATH_ROOT:-}" ] && [ -d "$GOOSE_PATH_ROOT" ]; then
  GOOSE_SRC="$GOOSE_PATH_ROOT"
elif [ -d "$HOME/Library/Application Support/Block/goose/sessions" ]; then
  GOOSE_SRC="$HOME/Library/Application Support/Block/goose/sessions"
elif [ -d "$HOME/.local/share/goose/sessions" ]; then
  GOOSE_SRC="$HOME/.local/share/goose/sessions"
fi
if [ -n "$GOOSE_SRC" ]; then
  rsync -a "$GOOSE_SRC/" "$DEST/goose/"
fi

# Cline-family extensions (Cline, Roo Code, KiloCode) — VS Code / Cursor globalStorage.
# Each task lives under tasks/<taskId>/ with ui_messages.json containing api_req_started events.
CLINE_DEST="$DEST/cline"
CLINE_EXT_IDS=(saoudrizwan.claude-dev rooveterinaryinc.roo-cline kilocode)
CLINE_HOSTS=("Code" "Cursor")
ANY_CLINE=0
for host in "${CLINE_HOSTS[@]}"; do
  for ext in "${CLINE_EXT_IDS[@]}"; do
    SRC="$HOME/Library/Application Support/$host/User/globalStorage/$ext/tasks"
    if [ -d "$SRC" ]; then
      mkdir -p "$CLINE_DEST/$host/$ext"
      rsync -a "$SRC/" "$CLINE_DEST/$host/$ext/tasks/"
      ANY_CLINE=1
    fi
  done
done
# Linux paths — VS Code stores under ~/.config/Code/User/globalStorage
for host_dir in "$HOME/.config/Code" "$HOME/.config/Cursor"; do
  [ -d "$host_dir" ] || continue
  host_name="$(basename "$host_dir")"
  for ext in "${CLINE_EXT_IDS[@]}"; do
    SRC="$host_dir/User/globalStorage/$ext/tasks"
    if [ -d "$SRC" ]; then
      mkdir -p "$CLINE_DEST/$host_name/$ext"
      rsync -a "$SRC/" "$CLINE_DEST/$host_name/$ext/tasks/"
      ANY_CLINE=1
    fi
  done
done
# Aggregate facts at snapshot time. Cover both projects/ and projects-archive/
# because Claude Code's cleanup process moves old dirs to projects-archive/
# (see ~/.claude/.last-cleanup) — the live `/stats` widget only reads projects/.
# Portable summary; count only directories that exist (Codex-only installs work).
node - "$DEST" "$DATE" <<'JS'
const fs = require('fs'), path = require('path');
const [dest, date] = process.argv.slice(2);
const kinds = fs.readdirSync(dest, {withFileTypes:true}).filter(e => e.isDirectory()).map(e => e.name);
fs.writeFileSync(path.join(dest, 'manifest.txt'), `snapshot_date: ${date}\nsources: ${kinds.join(', ')}\n`, {mode:0o600});
console.log(`Snapshot sources: ${kinds.length}`);
JS

# Build cwd-manifest.json: for each project dir we can map back to a real
# filesystem path, capture its git remote URL. Builders use this to merge
# projects sharing a remote (catches local renames, mv across paths) without
# requiring hand-curated aliases.
echo
echo "Scanning live projects for git remotes..."
node "$(dirname "$0")/lib/build-cwd-manifest.js" "$DEST"

echo
echo "Snapshot saved to $DEST"
