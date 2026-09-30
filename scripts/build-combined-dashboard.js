#!/usr/bin/env node
// Combined dashboard: merges per-tool aggregates into one view.
// Run after both build-dashboard.js and build-codex-dashboard.js have written data/*-agg.json.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, DATA_DIR, ensureDataRoot } = require('./lib/paths');
const { renderTemplate } = require('./lib/render-template');
const { writeEmptyState } = require('./lib/empty-state');
const { pendingMergesCount } = require('./lib/pending-merges-count');
const { resolveSources } = require('./lib/sources');

ensureDataRoot();
const OUT = path.join(DATA_ROOT, 'combined-dashboard.html');

function loadAgg(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const claude = loadAgg('claude-agg.json');
const codex = loadAgg('codex-agg.json');
const claudeWeb = loadAgg('claude-web-agg.json');
const gemini = loadAgg('gemini-agg.json');
const goose = loadAgg('goose-agg.json');
const cline = loadAgg('cline-agg.json');
if (!claude && !codex && !claudeWeb && !gemini && !goose && !cline) {
  writeEmptyState(OUT, { tool: 'combined', dataRoot: DATA_ROOT, sourceHint: '~/.claude/projects/ or ~/.codex/archived_sessions/' });
  process.exit(0);
}

const sources = [];
if (claude) sources.push({ tool: 'claude', agg: claude });
if (codex) sources.push({ tool: 'codex', agg: codex });
if (claudeWeb) sources.push({ tool: 'claude-web', agg: claudeWeb });
if (gemini) sources.push({ tool: 'gemini', agg: gemini });
if (goose) sources.push({ tool: 'goose', agg: goose });
if (cline) sources.push({ tool: 'cline', agg: cline });

// Merge per-day heatmap. Sum sessions/messages; byModel entries get a `tool` tag.
// byProject entries merged by (name, tool) — same project across tools shows split per tool.
const perDay = new Map();
for (const { tool, agg } of sources) {
  for (const d of agg.heatmap) {
    let merged = perDay.get(d.day);
    if (!merged) { merged = { day: d.day, sessions: 0, messages: 0, locAdditions: 0, locDeletions: 0, byModel: [], byProject: [], perTool: {} }; perDay.set(d.day, merged); }
    merged.sessions += d.sessions;
    merged.messages += d.messages;
    merged.locAdditions += (d.locAdditions || 0);
    merged.locDeletions += (d.locDeletions || 0);
    merged.perTool[tool] = { sessions: d.sessions, messages: d.messages, locAdditions: d.locAdditions || 0, locDeletions: d.locDeletions || 0 };
    for (const u of d.byModel) merged.byModel.push({ ...u, tool });
    for (const p of (d.byProject || [])) merged.byProject.push({ ...p, tool: p.tool || tool });
  }
}
const heatmap = [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day));

// Merge projects. Same project name → sum tokens/messages/sessions, union days, track tools.
const perProject = new Map();
for (const { tool, agg } of sources) {
  for (const p of agg.projects) {
    let g = perProject.get(p.name);
    if (!g) { g = { name: p.name, sessions: 0, messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived: true, worktrees: 0, mergedFrom: new Set(), tools: new Set() }; perProject.set(p.name, g); }
    g.sessions += p.sessions;
    g.messages += p.messages;
    g.tokens += p.tokens;
    g.locAdditions += (p.locAdditions || 0);
    g.locDeletions += (p.locDeletions || 0);
    for (const d of p.days) g.days.add(d);
    for (const m of (p.mergedFrom || [])) g.mergedFrom.add(m);
    g.worktrees += (p.worktrees || 0); // sum across tools — claude worktrees + codex worktrees are distinct dirs
    if (!p.archived) g.archived = false;
    g.tools.add(tool);
  }
}
const projects = [...perProject.values()].map(p => ({
  name: p.name,
  sessions: p.sessions,
  messages: p.messages,
  tokens: p.tokens,
  locAdditions: p.locAdditions,
  locDeletions: p.locDeletions,
  days: [...p.days],
  archived: p.archived,
  worktrees: p.worktrees,
  mergedFrom: [...p.mergedFrom],
  tools: [...p.tools].join('+'),
}));

// Combined pricing dict: union of all models. Models from different providers have non-overlapping names (claude-* vs gpt-*).
const mergedModels = {};
for (const { agg } of sources) Object.assign(mergedModels, agg.pricing.models || {});

// Combined subscription: sum monthly_usd, take earliest start, label = " + ".
const subs = sources.map(s => s.agg.pricing.subscription).filter(Boolean);
const subscription = subs.length ? {
  tier: subs.map(s => s.tier).join(' + '),
  monthly_usd: subs.reduce((sum, s) => sum + (s.monthly_usd || 0), 0),
  started: subs.map(s => s.started).sort()[0],
} : null;

const allDays = heatmap.map(d => d.day);
const totalSessionsAllTime = sources.reduce((sum, s) => sum + (s.agg.summary.totalSessionsAllTime || 0), 0);
const totalLocAdditions = sources.reduce((sum, s) => sum + (s.agg.summary.totalLocAdditions || 0), 0);
const totalLocDeletions = sources.reduce((sum, s) => sum + (s.agg.summary.totalLocDeletions || 0), 0);
const unknownModels = [].concat(...sources.map(s => s.agg.summary.unknownModels || []));
const homePrefix = sources.map(s => s.agg.summary.homePrefix).filter(Boolean)[0] || '';
// Each per-tool agg carries the date of the data it was built from. Report the
// newest as the combined "as of" date, and name any tool lagging behind it —
// an agg only refreshes when its builder runs, so a tool whose source dir has
// gone missing would otherwise contribute months-old days with no hint of it.
const aggDates = sources.map(s => s.agg.summary.snapshot).filter(Boolean).sort();
const newestAggDate = aggDates.length ? aggDates[aggDates.length - 1] : null;
const staleTools = sources
  .filter(s => s.agg.summary.snapshot && s.agg.summary.snapshot !== newestAggDate)
  .map(s => ({ tool: s.tool, snapshot: s.agg.summary.snapshot }));

const summary = {
  tool: 'combined',
  tools: sources.map(s => s.tool),
  snapshot: newestAggDate || sources[0].agg.summary.snapshot,
  live: resolveSources().live,
  staleTools,
  generatedAt: new Date().toISOString(),
  firstDay: allDays[0] || null,
  lastDay: allDays[allDays.length - 1] || null,
  totalSessionsAllTime,
  totalLocAdditions,
  totalLocDeletions,
  unknownModels,
  pendingMergesCount: pendingMergesCount(),
  homePrefix,
  perTool: Object.fromEntries(sources.map(s => [s.tool, s.agg.summary])),
};

const pricing = { models: mergedModels, subscription, fastModeMultiplier: { value: 1 } };
const payload = { summary, heatmap, projects, pricing };

// Sanity: compute total cost
function usageCost(model, u) {
  const p = mergedModels[model]; if (!p) return 0;
  return (u.input * p.input + u.output * p.output + (u.cacheRead || 0) * (p.cache_read || 0) + (u.cacheCreate5m || 0) * (p.cache_5m || 0) + (u.cacheCreate1h || 0) * (p.cache_1h || 0)) / 1e6;
}
let totalCost = 0;
const costByTool = {};
for (const d of heatmap) for (const u of d.byModel) {
  const c = usageCost(u.model, u);
  totalCost += c;
  costByTool[u.tool] = (costByTool[u.tool] || 0) + c;
}

console.log(`Combined dashboard:`);
console.log(`  Tools: ${sources.map(s => s.tool).join(', ')}`);
console.log(`  Days: ${heatmap.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
console.log(`  Sessions: ${totalSessionsAllTime}`);
console.log(`  LOC: +${totalLocAdditions}  -${totalLocDeletions}  net ${totalLocAdditions - totalLocDeletions}`);
console.log(`  Per-tool API cost:`);
for (const [t, c] of Object.entries(costByTool)) console.log(`    ${t.padEnd(10)} $${c.toFixed(2)}`);
console.log(`  Total API cost: $${totalCost.toFixed(2)}`);
if (subscription) console.log(`  Subscription: ${subscription.tier} @ $${subscription.monthly_usd}/mo`);

if (staleTools.length) {
  console.log(`  Stale aggregates (older than ${newestAggDate}): ${staleTools.map(t => `${t.tool}@${t.snapshot}`).join(', ')}`);
}

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>AI usage — combined</title>' }));
console.log(`Wrote ${OUT}`);

// Dump the merged payload as JSON too. The vite dev preview loads this instead
// of a checked-in fixture, so `pnpm dev` shows real, current data.
const aggOut = path.join(DATA_DIR, 'combined-agg.json');
fs.writeFileSync(aggOut, JSON.stringify(payload));
console.log(`Wrote ${aggOut}`);
