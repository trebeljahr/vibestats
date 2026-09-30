// Detect medium-confidence project-merge candidates the auto-merge
// (shared git remote) couldn't resolve. Writes pending-merges.json
// for the `vibestats merges` CLI to surface to the user.
//
// Signals used:
//   - Levenshtein distance ≤ 2 on basenames (length ≥ 4)
//     catches: typo renames ("myproj" / "my-proj"), case changes,
//     trailing-letter swaps
//   - NOT used: timestamp adjacency (too easy to false-positive when
//     legitimate sister projects are created in the same week)
//   - NOT used: shared sessionId across dirs (handled silently by the
//     auto-merge layer when fs evidence exists)
//
// We only suggest pairs where neither side is already covered by an
// alias and neither shares a git remote with the other (those merge
// silently). Skipped pairs go to a separate skipped list for debugging.

const fs = require('fs');
const path = require('path');

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Strip the standard prefix "-Users-<name>-projects-" so we compare just
// the project leaf. Falls back to last segment if pattern doesn't match.
function projectLeaf(encodedName) {
  const stripped = encodedName.replace(/--claude-worktrees-.*$/, '');
  const m = stripped.match(/^-(Users|home)-[^-]+-projects-(.+)$/);
  return m ? m[2] : stripped.split('-').slice(-1)[0];
}

function findMergeCandidates(opts) {
  const { perProjectNames, cwdManifest, aliasMap } = opts;
  const names = [...perProjectNames];
  // remote → canonical map (subset already silently merged by builders)
  const remoteByName = new Map();
  for (const [name, info] of Object.entries(cwdManifest || {})) {
    if (info.remote) remoteByName.set(name, info.remote);
  }
  // Already-aliased names should be excluded — user already decided
  const isAliased = name => aliasMap.has(name) || [...aliasMap.values()].includes(name);

  const candidates = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      if (isAliased(a) || isAliased(b)) continue;
      // Same git remote → handled silently, skip
      const ra = remoteByName.get(a), rb = remoteByName.get(b);
      if (ra && rb && ra === rb) continue;

      const la = projectLeaf(a), lb = projectLeaf(b);
      if (la === lb) continue; // same canonical already
      if (la.length < 4 || lb.length < 4) continue; // too short, signal-noisy
      const dist = levenshtein(la, lb);
      if (dist > 2) continue;

      // Build evidence
      const evidence = { leafDistance: dist, leafA: la, leafB: lb };
      if (ra) evidence.remoteA = ra;
      if (rb) evidence.remoteB = rb;

      // Suggest the shorter (or alphabetically earlier) leaf as canonical
      const canonical = la.length === lb.length
        ? (la < lb ? la : lb)
        : (la.length < lb.length ? la : lb);
      const other = canonical === la ? b : a;
      const canonicalEncoded = canonical === la ? a : b;

      candidates.push({
        id: `${la}--${lb}`.slice(0, 60),
        canonical,
        canonical_encoded: canonicalEncoded,
        merge_in: other,
        evidence,
      });
    }
  }
  // Stable order: by distance, then canonical name
  candidates.sort((p, q) => p.evidence.leafDistance - q.evidence.leafDistance || p.canonical.localeCompare(q.canonical));
  return candidates;
}

function writePendingMerges(outPath, candidates) {
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: candidates.length,
    candidates,
  }, null, 2) + '\n', { mode: 0o600 });
}

module.exports = { findMergeCandidates, writePendingMerges, projectLeaf, levenshtein };
