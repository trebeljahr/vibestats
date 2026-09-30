#!/usr/bin/env node
// Scan built aggregates + cwd-manifest for medium-confidence project-merge
// candidates the auto-merge layer couldn't resolve. Writes
// pending-merges.json to DATA_ROOT for `vibestats merges` to surface.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, DATA_DIR, ALIASES_PATH } = require('./lib/paths');
const { resolveSources } = require('./lib/sources');
const { findMergeCandidates, writePendingMerges } = require('./lib/find-merges');

const src = resolveSources();
if (!src.live && !src.snapshotName) { console.log('detect-merges: no snapshot yet, skipping.'); process.exit(0); }

const cwdManifestPath = src.cwdManifestPath();
const cwdManifest = cwdManifestPath && fs.existsSync(cwdManifestPath)
  ? JSON.parse(fs.readFileSync(cwdManifestPath, 'utf8'))
  : {};

const aliasesCfg = fs.existsSync(ALIASES_PATH) ? JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8')) : { aliases: {} };
const aliasMap = new Map();
for (const [canonical, dirs] of Object.entries(aliasesCfg.aliases || {})) {
  for (const d of dirs) aliasMap.set(d, canonical);
}

// Walk the raw source dirs directly so we have no dependency on builders.
// Strip --claude-worktrees-* suffix to consolidate worktrees of one project.
const allNames = new Set();
for (const sub of ['projects', 'projects-archive']) {
  const root = src.dir(sub);
  if (!root) continue;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    allNames.add(ent.name.replace(/--claude-worktrees-.*$/, ''));
  }
}
// Codex worktree dirs come from cwd-manifest (already canonicalised by build-cwd-manifest)
for (const k of Object.keys(cwdManifest)) allNames.add(k);

const candidates = findMergeCandidates({
  perProjectNames: allNames,
  cwdManifest,
  aliasMap,
});

const out = path.join(DATA_ROOT, 'pending-merges.json');
writePendingMerges(out, candidates);
console.log(`detect-merges: ${candidates.length} candidate pair(s). Wrote ${out}.`);
if (candidates.length) {
  console.log('  Review with: vibestats merges list');
}
