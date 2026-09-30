// Where builders read raw transcripts from.
//
// Two modes:
//   snapshot (default) — newest dated dir under $DATA_ROOT/snapshots/, an
//                        rsync copy taken by scripts/snapshot.sh.
//   live   (VIBESTATS_LIVE=1) — the source dirs in $HOME, read in place.
//
// Live mode exists because a snapshot copies ~2GB (projects-archive alone is
// most of it), so it only ever runs when the user explicitly asks. That made
// every non-snapshot entry point — vite dev preview, `vibestats build`,
// reopening an already-built dashboard — silently show whatever the last
// snapshot froze, sometimes months old. Live mode runs the same parsers
// against the live dirs, so a rebuild takes seconds and reflects sessions
// from minutes ago.
//
// claude-web is snapshot-only: it has no live dir at all (`vibestats fetch-web`
// writes it into the newest snapshot), so live mode falls back to the snapshot
// copy for that one kind.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SNAP_ROOT, DATA_DIR } = require('./paths');

const LIVE = /^(1|true|yes|on)$/i.test(process.env.VIBESTATS_LIVE || '');

const HOME = os.homedir();

// snapshot subdir name → candidate live dirs, first existing one wins.
const LIVE_DIRS = {
  'projects': [path.join(HOME, '.claude', 'projects')],
  'projects-archive': [path.join(HOME, '.claude', 'projects-archive')],
  'codex-sessions': [path.join(HOME, '.codex', 'archived_sessions')],
  'gemini-antigravity-conversations': [path.join(HOME, '.gemini', 'antigravity', 'conversations')],
  'gemini-tmp': [path.join(HOME, '.gemini', 'tmp')],
  'gemini-history': [path.join(HOME, '.gemini', 'history')],
  'goose': [
    process.env.GOOSE_PATH_ROOT,
    path.join(HOME, 'Library', 'Application Support', 'Block', 'goose', 'sessions'),
    path.join(HOME, '.local', 'share', 'goose', 'sessions'),
  ].filter(Boolean),
};

// Mirrors snapshot.sh's Cline sweep: <host>/User/globalStorage/<ext>/tasks/.
const CLINE_EXT_IDS = ['saoudrizwan.claude-dev', 'rooveterinaryinc.roo-cline', 'kilocode'];
const CLINE_HOST_ROOTS = [
  path.join(HOME, 'Library', 'Application Support', 'Code'),
  path.join(HOME, 'Library', 'Application Support', 'Cursor'),
  path.join(HOME, '.config', 'Code'),
  path.join(HOME, '.config', 'Cursor'),
];

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function snapshotNames() {
  if (!fs.existsSync(SNAP_ROOT)) return [];
  return fs.readdirSync(SNAP_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function latestSnapshotName() {
  const names = snapshotNames();
  return names.length ? names[names.length - 1] : null;
}

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Resolve the source set for this run. `live` and `snapshotName` are both
// reported so builders can label their output honestly.
function resolveSources() {
  const snapName = latestSnapshotName();
  const live = LIVE;
  const snapDir = snapName ? path.join(SNAP_ROOT, snapName) : null;

  function dir(kind) {
    if (live) {
      const candidates = LIVE_DIRS[kind];
      if (candidates) return candidates.find(isDir) || null;
      // No live equivalent (claude-web) — fall back to the snapshot copy.
    }
    if (!snapDir) return null;
    const p = path.join(snapDir, kind);
    return isDir(p) ? p : null;
  }

  // Cline tasks live under a host/extension matrix rather than one dir.
  // Returns [{ tasksDir, ext }] for whichever mode is active.
  function clineTaskDirs() {
    const out = [];
    if (live) {
      for (const host of CLINE_HOST_ROOTS) {
        for (const ext of CLINE_EXT_IDS) {
          const tasksDir = path.join(host, 'User', 'globalStorage', ext, 'tasks');
          if (isDir(tasksDir)) out.push({ tasksDir, ext });
        }
      }
      return out;
    }
    const root = dir('cline');
    if (!root) return out;
    for (const hostEnt of fs.readdirSync(root, { withFileTypes: true })) {
      if (!hostEnt.isDirectory()) continue;
      const hostDir = path.join(root, hostEnt.name);
      for (const extEnt of fs.readdirSync(hostDir, { withFileTypes: true })) {
        if (!extEnt.isDirectory()) continue;
        const tasksDir = path.join(hostDir, extEnt.name, 'tasks');
        if (isDir(tasksDir)) out.push({ tasksDir, ext: extEnt.name });
      }
    }
    return out;
  }

  // Snapshot mode keeps the manifest next to the data it describes; live mode
  // has no snapshot dir to write into, so it caches under $DATA_ROOT/data/.
  function cwdManifestPath() {
    if (live) return path.join(DATA_DIR, 'cwd-manifest-live.json');
    return snapDir ? path.join(snapDir, 'cwd-manifest.json') : null;
  }

  return {
    live,
    snapshotName: snapName,
    // What the dashboard header reports as `summary.snapshot`.
    date: live ? today() : snapName,
    label: live ? 'live source dirs' : `snapshot ${snapName}`,
    dir,
    clineTaskDirs,
    cwdManifestPath,
  };
}

module.exports = { LIVE, resolveSources, snapshotNames, latestSnapshotName, LIVE_DIRS };

// Tiny CLI so bash callers (build-all.sh) can ask the same resolver the
// builders use instead of re-deriving snapshot paths:
//   node scripts/lib/sources.js has <kind>   exit 0 if that source resolves
//   node scripts/lib/sources.js label        print the human label
if (require.main === module) {
  const [cmd, kind] = process.argv.slice(2);
  const src = resolveSources();
  if (cmd === 'has') {
    const present = kind === 'cline' ? src.clineTaskDirs().length > 0 : !!src.dir(kind);
    process.exit(present ? 0 : 1);
  } else if (cmd === 'label') {
    console.log(src.label);
  } else {
    console.error('usage: sources.js has <kind> | label');
    process.exit(2);
  }
}
