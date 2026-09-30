#!/usr/bin/env node
// CLI for managing pending merge candidates surfaced by detect-merges.js.
//
// Usage:
//   vibestats merges                       # list (default)
//   vibestats merges list
//   vibestats merges accept <id>           # add to project-aliases.json
//   vibestats merges reject <id>           # remove from pending-merges.json
//   vibestats merges clear                 # drop all pending

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, ALIASES_PATH } = require('./lib/paths');

const PENDING = path.join(DATA_ROOT, 'pending-merges.json');

const subcmd = process.argv[2] || 'list';
const arg = process.argv[3];

function load() {
  if (!fs.existsSync(PENDING)) {
    console.log('No pending merges file yet. Run `vibestats build` to populate.');
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(PENDING, 'utf8'));
}
function save(data) {
  fs.writeFileSync(PENDING, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}
function loadAliases() {
  if (!fs.existsSync(ALIASES_PATH)) return { aliases: {} };
  return JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));
}
function saveAliases(cfg) {
  fs.writeFileSync(ALIASES_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

function fmtCandidate(c, i) {
  return [
    `  [${i + 1}] ${c.canonical}    (id: ${c.id})`,
    `      Levenshtein ${c.evidence.leafDistance}: ${c.evidence.leafA} ↔ ${c.evidence.leafB}`,
    `      Merge   ${c.merge_in}`,
    `      Into    ${c.canonical_encoded}`,
  ].join('\n');
}

if (subcmd === 'list' || subcmd === 'ls') {
  const data = load();
  if (!data.count) {
    console.log('No pending merges. Auto-merge handled everything.');
    process.exit(0);
  }
  console.log(`${data.count} pending merge candidate(s):\n`);
  data.candidates.forEach((c, i) => console.log(fmtCandidate(c, i) + '\n'));
  console.log('Accept:  vibestats merges accept <id>');
  console.log('Reject:  vibestats merges reject <id>');
} else if (subcmd === 'accept') {
  if (!arg) { console.error('Usage: vibestats merges accept <id>'); process.exit(1); }
  const data = load();
  const idx = data.candidates.findIndex(c => c.id === arg);
  if (idx < 0) { console.error(`No candidate with id "${arg}".`); process.exit(1); }
  const c = data.candidates[idx];
  const aliases = loadAliases();
  if (!aliases.aliases) aliases.aliases = {};
  const list = aliases.aliases[c.canonical] || [];
  if (!list.includes(c.canonical_encoded)) list.push(c.canonical_encoded);
  if (!list.includes(c.merge_in)) list.push(c.merge_in);
  aliases.aliases[c.canonical] = list;
  saveAliases(aliases);
  data.candidates.splice(idx, 1);
  data.count = data.candidates.length;
  save(data);
  console.log(`Accepted. project-aliases.json now maps "${c.canonical}" -> [${list.join(', ')}].`);
  console.log('Re-run `vibestats build` to apply.');
} else if (subcmd === 'reject') {
  if (!arg) { console.error('Usage: vibestats merges reject <id>'); process.exit(1); }
  const data = load();
  const idx = data.candidates.findIndex(c => c.id === arg);
  if (idx < 0) { console.error(`No candidate with id "${arg}".`); process.exit(1); }
  data.candidates.splice(idx, 1);
  data.count = data.candidates.length;
  save(data);
  console.log(`Rejected. Removed from pending list.`);
  console.log('Note: detect-merges will re-suggest this pair on next run unless the underlying data changes. Use `vibestats merges clear` if it keeps reappearing.');
} else if (subcmd === 'clear') {
  save({ generatedAt: new Date().toISOString(), count: 0, candidates: [] });
  console.log('Cleared all pending merges.');
} else {
  console.error(`Unknown subcommand "${subcmd}". Use list | accept <id> | reject <id> | clear.`);
  process.exit(1);
}
