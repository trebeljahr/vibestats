#!/usr/bin/env node
/*
 * build-cwd-manifest — for each project dir in a snapshot, attempt to
 * recover the actual filesystem cwd and grab its git remote URL.
 *
 * For Claude Code dirs (encoded `-Users-example-projects-foo`), reverse the
 * encoding by replacing dashes with slashes from the left, walking until
 * we find a path that exists on disk. (Project basenames containing
 * dashes are common — `name-checker`, `mood-magic` — so simple
 * `.replace(/-/g, '/')` is wrong.)
 *
 * For Codex sessions, parse `cwd` directly from the first session_meta
 * event in each rollout.
 *
 * Usage:
 *   build-cwd-manifest.js <snapDir>   read a snapshot dir, write <snapDir>/cwd-manifest.json
 *   build-cwd-manifest.js --live      read the live source dirs, write
 *                                     $DATA_ROOT/data/cwd-manifest-live.json
 *
 * Output: { "<encoded-key>": { cwd, remote, repoRoot } }
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveSources } = require('./sources');

const ARG = process.argv[2];
if (!ARG) { console.error('usage: build-cwd-manifest.js <snapDir> | --live'); process.exit(1); }
// --live resolves each source dir independently (they live under different
// parents in $HOME), so roots are looked up by kind rather than joined onto SNAP.
const LIVE_MODE = ARG === '--live';
const src = LIVE_MODE ? resolveSources() : null;
if (LIVE_MODE && !src.live) {
  console.error('build-cwd-manifest.js --live requires VIBESTATS_LIVE=1');
  process.exit(1);
}
const SNAP = LIVE_MODE ? null : ARG;
const rootFor = kind => (LIVE_MODE ? src.dir(kind) : path.join(SNAP, kind));

const manifest = {};
const stats = { tried: 0, resolved: 0, withRemote: 0 };

function validCwd(cwd) {
  return typeof cwd === 'string' && cwd.length > 0 && !cwd.includes('\0');
}

function gitInfo(cwd) {
  if (!validCwd(cwd)) return null;
  try {
    // Transcript paths are arguments, never shell command text.
    const repoRoot = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    let remote = null;
    try {
      remote = execFileSync('git', ['-C', cwd, 'config', '--get', 'remote.origin.url'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch { /* repo with no remote */ }
    return { repoRoot, remote };
  } catch {
    return null;
  }
}

// Reverse Claude's path encoding: `-Users-example-projects-foo-bar` could be
// /Users/example/projects/foo-bar or /Users/example/projects/foo/bar. Walk the
// dash positions left-to-right replacing each with /, and check if path exists.
function decodeClaudeKey(key) {
  if (!key.startsWith('-')) return null;
  // First dash is always /, so /<rest>
  const parts = key.slice(1).split('-');
  // Try increasingly conservative slash placements: every dash → /, then
  // collapse trailing groups into a single basename with dashes.
  for (let split = parts.length; split >= 1; split--) {
    const dirPart = '/' + parts.slice(0, split).join('/');
    const basename = parts.slice(split).join('-');
    const candidate = basename ? path.join(dirPart, basename) : dirPart;
    try {
      const st = fs.statSync(candidate);
      if (st.isDirectory()) return candidate;
    } catch { /* not it */ }
  }
  return null;
}

// Claude projects (live + archive)
for (const sub of ['projects', 'projects-archive']) {
  const root = rootFor(sub);
  if (!root || !fs.existsSync(root)) continue;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    stats.tried++;
    // Strip --claude-worktrees-* suffix before decoding (worktrees aren't on disk under that key)
    const baseKey = ent.name.replace(/--claude-worktrees-.*$/, '');
    const cwd = decodeClaudeKey(baseKey);
    if (!cwd) continue;
    stats.resolved++;
    const git = gitInfo(cwd);
    if (!git) continue;
    if (git.remote) stats.withRemote++;
    manifest[baseKey] = { cwd, remote: git.remote, repoRoot: git.repoRoot };
  }
}

// Codex sessions — extract cwd from session_meta in each rollout
const codexDir = rootFor('codex-sessions');
if (codexDir && fs.existsSync(codexDir)) {
  const cwdsSeen = new Set();
  for (const file of fs.readdirSync(codexDir)) {
    if (!file.endsWith('.jsonl')) continue;
    const fp = path.join(codexDir, file);
    let cwd = null;
    try {
      const content = fs.readFileSync(fp, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj && obj.type === 'session_meta' && obj.payload && validCwd(obj.payload.cwd)) {
          cwd = obj.payload.cwd;
          break;
        }
      }
    } catch { continue; }
    if (!validCwd(cwd) || cwdsSeen.has(cwd)) continue;
    cwdsSeen.add(cwd);
    stats.tried++;
    // Codex worktree path? Reverse to canonical project dir.
    const wt = cwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)\/\.codex\/worktrees\/[a-zA-Z0-9]+\/(.+)$/);
    const probe = wt ? `${wt[1]}/projects/${wt[2]}` : cwd;
    const probeKey = probe.replace(/[\/._]/g, '-');
    if (manifest[probeKey]) continue; // already filled from claude side
    const git = gitInfo(fs.existsSync(probe) ? probe : cwd);
    if (!git) continue;
    stats.resolved++;
    if (git.remote) stats.withRemote++;
    manifest[probeKey] = { cwd: probe, remote: git.remote, repoRoot: git.repoRoot };
  }
}

const out = LIVE_MODE ? src.cwdManifestPath() : path.join(SNAP, 'cwd-manifest.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`  cwd-manifest: tried ${stats.tried} dirs, resolved ${stats.resolved} to filesystem paths, ${stats.withRemote} with git remotes. Wrote ${out}`);
