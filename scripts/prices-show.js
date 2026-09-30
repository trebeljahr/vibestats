#!/usr/bin/env node
// List per-MTok prices for the models that actually appear in your built
// dashboards. Reads data/*-agg.json (no jsonl re-parse) and the merged
// pricing view (pricing.json + pricing-cache.json layered).
//
// Each row shows the model, its source (cache | pricing.json), and the
// in/cache_read/out rates. Models that have usage but no price entry are
// flagged so you know to either add them to pricing.json or fetch fresh
// prices via `vibestats prices update`.

const fs = require('fs');
const path = require('path');
const { DATA_DIR, PRICING_PATH, ensureDataRoot } = require('./lib/paths');
const { loadMergedPricing, PRICING_CACHE_PATH } = require('./lib/pricing');

ensureDataRoot();

const merged = loadMergedPricing();
const baseFile = fs.existsSync(PRICING_PATH) ? JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8')) : { models: {}, openai_models: {} };
const cacheFile = fs.existsSync(PRICING_CACHE_PATH) ? JSON.parse(fs.readFileSync(PRICING_CACHE_PATH, 'utf8')) : null;

// Collect models actually used, with rough usage tallies
const used = new Map(); // model -> { tools: Set, messages, input, output, cacheRead }
for (const agg of ['claude-agg.json', 'codex-agg.json', 'claude-web-agg.json']) {
  const p = path.join(DATA_DIR, agg);
  if (!fs.existsSync(p)) continue;
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  for (const d of data.heatmap || []) {
    for (const u of d.byModel || []) {
      const k = u.model;
      let row = used.get(k);
      if (!row) { row = { tools: new Set(), messages: 0, input: 0, output: 0, cacheRead: 0 }; used.set(k, row); }
      row.tools.add(u.tool || data.summary.tool || '?');
      row.messages += u.messages || 0;
      row.input += u.input || 0;
      row.output += u.output || 0;
      row.cacheRead += u.cacheRead || 0;
    }
  }
}

if (used.size === 0) {
  console.log('No model usage found in data/*-agg.json. Run `vibestats build` first.');
  process.exit(0);
}

// Resolve each used model against merged pricing + figure out source
function lookup(model) {
  // Try Claude pool first, then OpenAI pool
  if (merged.models && merged.models[model]) {
    const inCache = cacheFile && cacheFile.models && cacheFile.models[model];
    const inBase = baseFile.models && baseFile.models[model];
    return { rate: merged.models[model], source: inCache ? 'cache' : (inBase ? 'pricing.json' : '?') };
  }
  if (merged.openai_models && merged.openai_models[model]) {
    const inCache = cacheFile && cacheFile.openai_models && cacheFile.openai_models[model];
    const inBase = baseFile.openai_models && baseFile.openai_models[model];
    return { rate: merged.openai_models[model], source: inCache ? 'cache' : (inBase ? 'pricing.json' : '?') };
  }
  return null;
}

// Header
const src = merged._pricingSource;
console.log(`Pricing source:`);
if (src && src.cacheUsed) {
  console.log(`  pricing-cache.json (${src.cacheEntries} entries, fetched ${src.cacheFetchedAt}) layered on pricing.json`);
} else {
  console.log(`  pricing.json only — run \`vibestats prices update\` to fetch fresh prices from LiteLLM`);
}
console.log();

const rows = [...used.entries()].sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));
const unpriced = [];

// Print table
const head = ['model', 'source', 'tool', 'msgs', '$in/MTok', '$cR/MTok', '$out/MTok'];
const widths = head.map(h => h.length);
const tableRows = [];
for (const [model, u] of rows) {
  const hit = lookup(model);
  if (!hit) { unpriced.push(model); }
  const r = hit ? hit.rate : null;
  const row = [
    model,
    hit ? hit.source : '(no price)',
    [...u.tools].join('+'),
    String(u.messages),
    r ? fmt(r.input) : '-',
    r ? fmt(r.cache_read) : '-',
    r ? fmt(r.output) : '-',
  ];
  for (let i = 0; i < row.length; i++) widths[i] = Math.max(widths[i], row[i].length);
  tableRows.push(row);
}

function pad(s, n, left = false) {
  if (s.length >= n) return s;
  return left ? s.padStart(n) : s.padEnd(n);
}
function fmt(n) { return '$' + Number(n).toFixed(n < 1 ? 3 : 2); }

const sep = widths.map(w => '-'.repeat(w)).join('  ');
console.log(head.map((h, i) => pad(h, widths[i], i >= 3)).join('  '));
console.log(sep);
for (const r of tableRows) {
  console.log(r.map((c, i) => pad(c, widths[i], i >= 3)).join('  '));
}

if (unpriced.length) {
  console.log();
  console.log(`${unpriced.length} model(s) used but unpriced — costs treated as $0:`);
  for (const m of unpriced) console.log(`  - ${m}`);
  console.log(`Fix by adding an entry to pricing.json, or running \`vibestats prices update\` if LiteLLM has it.`);
}
