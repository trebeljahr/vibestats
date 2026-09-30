#!/usr/bin/env node
// Read latest snapshot, aggregate per-day/per-project/per-model stats with cache-TTL
// breakdown, inject into dashboard-template.html. No deps.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_ROOT, DATA_DIR, ALIASES_PATH, ensureDataRoot } = require('./lib/paths');
const { renderTemplate } = require('./lib/render-template');
const { resolveSources } = require('./lib/sources');
const { writeEmptyState } = require('./lib/empty-state');
const { pendingMergesCount } = require('./lib/pending-merges-count');
const { loadMergedPricing } = require('./lib/pricing');
const { extractLocFromClaudeLine } = require('./lib/loc-claude');

// Encoded form of the user's home dir, used by the dashboard JS to strip
// "-Users-<name>-projects-" / "-home-<name>-projects-" prefixes from
// displayed project names. Computing it here instead of hardcoding "rico".
const HOME_PREFIX = os.homedir().replace(/\//g, '-');

ensureDataRoot();
const OUT = path.join(DATA_ROOT, 'dashboard.html');
const pricing = loadMergedPricing();
const aliasesCfg = fs.existsSync(ALIASES_PATH) ? JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8')) : { aliases: {} };
// Build reverse map: dir-name → canonical
const aliasMap = new Map();
for (const [canonical, dirs] of Object.entries(aliasesCfg.aliases || {})) {
  for (const d of dirs) aliasMap.set(d, canonical);
}
const src = resolveSources();
const SOURCES = [
  { root: src.dir('projects'), archived: false },
  { root: src.dir('projects-archive'), archived: true },
].filter(s => s.root);
if (!SOURCES.length) {
  writeEmptyState(OUT, { tool: 'claude', dataRoot: DATA_ROOT, sourceHint: '~/.claude/projects/' });
  process.exit(0);
}
const SNAP_NAME = src.date;
console.log(`Using ${src.label}`);

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && e.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}

const dayKey = ts => ts.slice(0, 10);
const perDay = new Map();
const perProject = new Map();
const totalSessions = new Set();
let totalMessages = 0, totalFiles = 0, totalLines = 0, totalParseErrors = 0;
let totalLocAdditions = 0, totalLocDeletions = 0;
const unknownModels = new Set();

function blankUsage() { return { messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 }; }
function blankProjectDay() { return { sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0 }; }

function bumpDay(day, sessionId, model, usage, rawProject, tokens) {
  let d = perDay.get(day);
  if (!d) { d = { sessions: new Set(), messages: 0, locAdditions: 0, locDeletions: 0, byModel: new Map(), byProject: new Map() }; perDay.set(day, d); }
  if (sessionId) d.sessions.add(sessionId);
  d.messages++;
  if (rawProject) {
    let p = d.byProject.get(rawProject);
    if (!p) { p = blankProjectDay(); d.byProject.set(rawProject, p); }
    if (sessionId) p.sessions.add(sessionId);
    p.messages++;
    p.tokens += tokens || 0;
  }
  // Skip lines without model (user messages, tool results) — they don't contribute cost
  // and would clutter the per-day model breakdown.
  if (!model) return;
  const m = model;
  let u = d.byModel.get(m);
  if (!u) { u = blankUsage(); d.byModel.set(m, u); }
  u.messages++;
  if (usage) {
    u.input += usage.input_tokens || 0;
    u.output += usage.output_tokens || 0;
    u.cacheRead += usage.cache_read_input_tokens || 0;
    const cc = usage.cache_creation || {};
    const c5 = cc.ephemeral_5m_input_tokens || 0;
    const c1h = cc.ephemeral_1h_input_tokens || 0;
    if (c5 || c1h) { u.cacheCreate5m += c5; u.cacheCreate1h += c1h; }
    else u.cacheCreate5m += usage.cache_creation_input_tokens || 0;
  }
}

function bumpProject(name, sessionId, day, archived, tokens) {
  let p = perProject.get(name);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived }; perProject.set(name, p); }
  if (archived) p.archived = true;
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages++;
  p.tokens += tokens;
}

function bumpLoc(day, rawProject, additions, deletions) {
  if (!additions && !deletions) return;
  totalLocAdditions += additions;
  totalLocDeletions += deletions;
  const d = perDay.get(day);
  if (d) {
    d.locAdditions += additions;
    d.locDeletions += deletions;
    if (rawProject) {
      const p = d.byProject.get(rawProject);
      if (p) {
        p.locAdditions += additions;
        p.locDeletions += deletions;
      }
    }
  }
  if (rawProject) {
    const p = perProject.get(rawProject);
    if (p) {
      p.locAdditions += additions;
      p.locDeletions += deletions;
    }
  }
}

for (const src of SOURCES) {
  if (!fs.existsSync(src.root)) continue;
  const projectDirs = fs.readdirSync(src.root, { withFileTypes: true }).filter(e => e.isDirectory());
  for (const pd of projectDirs) {
    const projectPath = path.join(src.root, pd.name);
    const files = walk(projectPath);
    for (const f of files) {
      totalFiles++;
      let content;
      try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const fileMtime = fs.statSync(f).mtime.toISOString();
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        totalLines++;
        let obj;
        try { obj = JSON.parse(line); } catch { totalParseErrors++; continue; }
        const ts = obj.timestamp || fileMtime;
        const day = dayKey(ts);
        const sessionId = obj.sessionId;
        const msg = obj.message || {};
        const usage = msg.usage;
        const model = msg.model;
        if (model && !pricing.models[model]) unknownModels.add(model);
        if (sessionId) totalSessions.add(sessionId);
        totalMessages++;
        const tokens = usage ? ((usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)) : 0;
        bumpDay(day, sessionId, model, usage, pd.name, tokens);
        bumpProject(pd.name, sessionId, day, src.archived, tokens);
        const loc = extractLocFromClaudeLine(obj, { projectDir: pd.name, fileMtime });
        if (loc) bumpLoc(loc.day, pd.name, loc.additions, loc.deletions);
      }
    }
  }
}

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'claude', dataRoot: DATA_ROOT, sourceHint: '~/.claude/projects/' });
  process.exit(0);
}

// Group worktrees under their base project + apply rename aliases + auto-merge
// projects sharing a git remote URL (catches mv-renames without aliases).
const stripWorktree = name => name.replace(/--claude-worktrees-.*$/, '');

// Load cwd-manifest (built by snapshot.sh -> build-cwd-manifest.js).
// Maps stripped base name → { cwd, remote, repoRoot }.
const cwdManifestPath = src.cwdManifestPath();
const cwdManifest = cwdManifestPath && fs.existsSync(cwdManifestPath)
  ? JSON.parse(fs.readFileSync(cwdManifestPath, 'utf8'))
  : {};
// Build remote → canonical name map. Pick the most-recently-active project's
// basename as the canonical when multiple share a remote.
const remoteToCanonical = (() => {
  const byRemote = new Map();
  for (const [base, info] of Object.entries(cwdManifest)) {
    if (!info.remote) continue;
    const arr = byRemote.get(info.remote) || [];
    arr.push(base);
    byRemote.set(info.remote, arr);
  }
  const m = new Map();
  for (const [remote, bases] of byRemote) {
    if (bases.length < 2) continue;
    // Use the shortest basename as canonical (usually the cleanest current name)
    const canonical = bases.slice().sort((a, b) => a.length - b.length)[0];
    for (const b of bases) m.set(b, canonical);
  }
  return m;
})();

const canonicalOf = name => {
  const base = stripWorktree(name);
  if (aliasMap.has(base)) return aliasMap.get(base);          // explicit alias wins
  if (remoteToCanonical.has(base)) return remoteToCanonical.get(base); // shared-remote merge
  return base;
};
const grouped = new Map();
for (const [name, p] of perProject) {
  const canonical = canonicalOf(name);
  const isWorktree = name !== stripWorktree(name);
  let g = grouped.get(canonical);
  if (!g) { g = { name: canonical, sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived: true, worktrees: 0, mergedFrom: new Set() }; grouped.set(canonical, g); }
  for (const s of p.sessions) g.sessions.add(s);
  g.messages += p.messages;
  g.tokens += p.tokens;
  g.locAdditions += p.locAdditions || 0;
  g.locDeletions += p.locDeletions || 0;
  for (const d of p.days) g.days.add(d);
  if (!p.archived) g.archived = false;
  if (isWorktree) g.worktrees += 1;
  g.mergedFrom.add(stripWorktree(name));
}
const projects = [...grouped.values()].map(p => ({
  name: p.name,
  sessions: p.sessions.size,
  messages: p.messages,
  tokens: p.tokens,
  locAdditions: p.locAdditions,
  locDeletions: p.locDeletions,
  days: [...p.days],
  archived: p.archived,
  worktrees: p.worktrees,
  mergedFrom: [...p.mergedFrom],
  tools: 'claude',
}));

// Emit heatmap with canonicalized byProject — done after canonicalOf is defined.
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'claude', ...u });
  const projGroup = new Map();
  for (const [rawName, p] of x.byProject) {
    const canon = canonicalOf(rawName);
    let g = projGroup.get(canon);
    if (!g) { g = { name: canon, sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0 }; projGroup.set(canon, g); }
    for (const s of p.sessions) g.sessions.add(s);
    g.messages += p.messages;
    g.tokens += p.tokens;
    g.locAdditions += p.locAdditions || 0;
    g.locDeletions += p.locDeletions || 0;
  }
  const byProject = [...projGroup.values()]
    .map(g => ({ name: g.name, tool: 'claude', sessions: g.sessions.size, messages: g.messages, tokens: g.tokens, locAdditions: g.locAdditions, locDeletions: g.locDeletions }))
    .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages);
  return { day: d, sessions: x.sessions.size, messages: x.messages, locAdditions: x.locAdditions, locDeletions: x.locDeletions, byModel, byProject };
});

const summary = {
  snapshot: SNAP_NAME,
  live: src.live,
  generatedAt: new Date().toISOString(),
  totalFiles, totalLines, totalParseErrors,
  totalLocAdditions, totalLocDeletions,
  firstDay: activeDays[0] || null,
  lastDay: activeDays[activeDays.length - 1] || null,
  totalSessionsAllTime: totalSessions.size,
  unknownModels: [...unknownModels],
  pendingMergesCount: pendingMergesCount(),
  homePrefix: HOME_PREFIX,
};

const payload = { summary, heatmap, projects, pricing };

console.log(`Files: ${totalFiles}  Lines: ${totalLines}  Parse errors: ${totalParseErrors}`);
console.log(`Active days: ${activeDays.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
console.log(`Sessions: ${totalSessions.size}  Messages: ${totalMessages}`);
console.log(`LOC: +${totalLocAdditions}  -${totalLocDeletions}  net ${totalLocAdditions - totalLocDeletions}`);
if (unknownModels.size) console.log(`Unknown models (no pricing, $0 contribution): ${[...unknownModels].join(', ')}`);

fs.writeFileSync(OUT, renderTemplate(payload));
console.log(`Wrote ${OUT}`);

// Also dump JSON aggregate for combined dashboard
const aggOut = path.join(DATA_DIR, 'claude-agg.json');
fs.writeFileSync(aggOut, JSON.stringify({ ...payload, summary: { ...payload.summary, tool: 'claude' } }));
console.log(`Wrote ${aggOut}`);
