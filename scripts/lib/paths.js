// Shared path resolution. CODE_ROOT is the package install dir (where scripts/
// templates live). DATA_ROOT is where snapshots, configs, and output dashboards
// live — separate so the package can be installed read-only (npm -g, Homebrew)
// while user data lives in their home dir.
//
// Resolution order for DATA_ROOT:
//   1. $VIBESTATS_DATA_DIR if set
//   2. If pricing.json exists in repo root (i.e. running from a clone), use repo root
//   3. Fall back to ~/.vibestats/

const fs = require('fs');
const path = require('path');
const os = require('os');

const CODE_ROOT = path.resolve(__dirname, '..', '..');

function resolveDataRoot() {
  if (process.env.VIBESTATS_DATA_DIR) return path.resolve(process.env.VIBESTATS_DATA_DIR);
  const repoConfig = path.join(CODE_ROOT, 'pricing.json');
  if (fs.existsSync(repoConfig)) return CODE_ROOT;
  const home = path.join(os.homedir(), '.vibestats');
  return home;
}

const DATA_ROOT = resolveDataRoot();

// Useful subpaths
const SNAP_ROOT = path.join(DATA_ROOT, 'snapshots');
const DATA_DIR = path.join(DATA_ROOT, 'data'); // per-tool JSON aggregates
const PRICING_PATH = path.join(DATA_ROOT, 'pricing.json');
const ALIASES_PATH = path.join(DATA_ROOT, 'project-aliases.json');
const TEMPLATE_PATH = path.join(CODE_ROOT, 'scripts', 'dashboard-template.html');
const SCRIPT_PATH = path.join(CODE_ROOT, 'scripts', 'dashboard-template.js');
const EXAMPLE_PRICING = path.join(CODE_ROOT, 'pricing.example.json');
const EXAMPLE_ALIASES = path.join(CODE_ROOT, 'project-aliases.example.json');

// 0700 on dirs / 0600 on files: data root contains full message transcripts
// (which often include pasted secrets), so keep it owner-only on shared hosts.
// Idempotent — chmods existing dirs even if mkdirSync was a no-op.
function ensureDataRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(SNAP_ROOT, { recursive: true, mode: 0o700 });
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_ROOT, 0o700); } catch {}
  try { fs.chmodSync(SNAP_ROOT, 0o700); } catch {}
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
  if (!fs.existsSync(PRICING_PATH) && fs.existsSync(EXAMPLE_PRICING)) {
    fs.copyFileSync(EXAMPLE_PRICING, PRICING_PATH);
    try { fs.chmodSync(PRICING_PATH, 0o600); } catch {}
  }
  if (!fs.existsSync(ALIASES_PATH) && fs.existsSync(EXAMPLE_ALIASES)) {
    fs.copyFileSync(EXAMPLE_ALIASES, ALIASES_PATH);
    try { fs.chmodSync(ALIASES_PATH, 0o600); } catch {}
  }
}

module.exports = {
  CODE_ROOT,
  DATA_ROOT,
  SNAP_ROOT,
  DATA_DIR,
  PRICING_PATH,
  ALIASES_PATH,
  TEMPLATE_PATH,
  SCRIPT_PATH,
  EXAMPLE_PRICING,
  EXAMPLE_ALIASES,
  ensureDataRoot,
};
