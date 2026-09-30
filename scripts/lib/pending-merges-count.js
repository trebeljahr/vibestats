// Tiny helper used by every builder to read the current pending-merges
// count and bake it into the dashboard's summary block — so the
// "N pending merges" banner can render without runtime fetches.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('./paths');

function pendingMergesCount() {
  const p = path.join(DATA_ROOT, 'pending-merges.json');
  if (!fs.existsSync(p)) return 0;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).count || 0; }
  catch { return 0; }
}

module.exports = { pendingMergesCount };
