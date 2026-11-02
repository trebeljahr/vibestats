// Tiny helper used by every builder to read the current pending-merges
// count and bake it into the dashboard's summary block — so the
// "N pending merges" banner can render without runtime fetches.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('./paths');

function readPendingMerges() {
  const p = path.join(DATA_ROOT, 'pending-merges.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return {}; }
}

function pendingMergesCount() {
  return readPendingMerges().count || 0;
}

// One key per candidate, so the banner can remember a dismissal for exactly
// the candidates it asked about. Built from the sorted pair because a
// candidate's id depends on which name was scanned first. Hashed so project
// names stay out of the page's banner state.
function pendingMergeKeys() {
  return (readPendingMerges().candidates || []).map(c =>
    crypto.createHash('sha256').update([c.canonical_encoded, c.merge_in].sort().join('\n')).digest('hex').slice(0, 16));
}

module.exports = { pendingMergesCount, pendingMergeKeys };
