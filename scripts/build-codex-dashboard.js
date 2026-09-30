#!/usr/bin/env node
// Read latest snapshot's codex-sessions/, aggregate per-day/per-project/per-model.
// Codex rollout schema: jsonl of {timestamp, type, payload}. Key events:
//   session_meta — { id, cwd, originator, cli_version, model_provider, source }
//   turn_context — { model, cwd, ... } (model may change mid-session)
//   event_msg.payload.type=token_count — { info: { last_token_usage: { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens } } }
//   response_item — model output (counts as messages)
// Produces codex-dashboard.html using same template as Claude dashboard.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_ROOT, DATA_DIR, ALIASES_PATH, ensureDataRoot } = require('./lib/paths');
const { renderTemplate } = require('./lib/render-template');
const { resolveSources } = require('./lib/sources');
const { writeEmptyState } = require('./lib/empty-state');
const { pendingMergesCount } = require('./lib/pending-merges-count');
const { loadMergedPricing } = require('./lib/pricing');
const { extractLocFromCodexLine } = require('./lib/loc-codex');

const HOME_PREFIX = os.homedir().replace(/\//g, '-');

ensureDataRoot();
const OUT = path.join(DATA_ROOT, 'codex-dashboard.html');
const pricing = loadMergedPricing();
const src = resolveSources();
const SNAP = src.dir('codex-sessions');
if (!SNAP) {
  writeEmptyState(OUT, { tool: 'codex', dataRoot: DATA_ROOT, sourceHint: '~/.codex/archived_sessions/' });
  process.exit(0);
}
const SNAP_NAME = src.date;
console.log(`Using ${src.label} (codex sessions)`);

// Repackage codex pricing into Claude-shaped pricing block so template's costing works unchanged.
// codex_models live under pricing.openai_models with same field names.
const codexPricing = {
  models: pricing.openai_models,
  subscription: pricing.codex_subscription,
  fastModeMultiplier: { value: 1 },
};

const files = fs.readdirSync(SNAP).filter(n => n.endsWith('.jsonl')).map(n => path.join(SNAP, n));
console.log(`${files.length} rollout files`);

const dayKey = ts => ts.slice(0, 10);
const perDay = new Map();
const perProject = new Map();
let totalMessages = 0, totalFiles = 0, totalLines = 0, totalParseErrors = 0;
let totalLocAdditions = 0, totalLocDeletions = 0;
const totalSessions = new Set();
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
  if (!model) return;
  let u = d.byModel.get(model);
  if (!u) { u = blankUsage(); d.byModel.set(model, u); }
  u.messages++;
  if (usage) {
    u.input += usage.input || 0;
    u.output += usage.output || 0;
    u.cacheRead += usage.cached || 0;
  }
}

function bumpProject(name, sessionId, day, tokens, worktreePath) {
  let p = perProject.get(name);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived: false, worktreeDirs: new Set() }; perProject.set(name, p); }
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages++;
  p.tokens += tokens;
  if (worktreePath) p.worktreeDirs.add(worktreePath);
}

function bumpLoc(day, rawProject, additions, deletions) {
  if (!additions && !deletions) return;
  totalLocAdditions += additions;
  totalLocDeletions += deletions;
  // Codex's apply_patch lines don't pass through bumpDay/bumpProject, so the
  // bucket may not exist yet. Create it on demand to keep LOC additive.
  let d = perDay.get(day);
  if (!d) { d = { sessions: new Set(), messages: 0, locAdditions: 0, locDeletions: 0, byModel: new Map(), byProject: new Map() }; perDay.set(day, d); }
  d.locAdditions += additions;
  d.locDeletions += deletions;
  if (rawProject) {
    let p = d.byProject.get(rawProject);
    if (!p) { p = blankProjectDay(); d.byProject.set(rawProject, p); }
    p.locAdditions += additions;
    p.locDeletions += deletions;
    let pp = perProject.get(rawProject);
    if (!pp) { pp = { sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived: false, worktreeDirs: new Set() }; perProject.set(rawProject, pp); }
    pp.locAdditions += additions;
    pp.locDeletions += deletions;
    pp.days.add(day);
  }
}

// Translate cwd to a stable project key matching Claude's encoding scheme.
// Claude encoding: /Users/example/projects/example-site -> -Users-example-projects-ricos-site
//   - slashes -> dashes
//   - dots    -> dashes (Claude does this)
//   - underscores -> dashes (defensive)
// Codex worktrees live at /Users/<u>/.codex/worktrees/<hash>/<project>. We rewrite
// those to the canonical /Users/<u>/projects/<project> path first so they collapse
// onto the same key as the base project (matches Claude's grouping behaviour).
function cwdToKey(cwd) {
  if (!cwd) return '-unknown';
  const wt = cwd.match(/^(\/Users\/[^/]+)\/\.codex\/worktrees\/[a-zA-Z0-9]+\/(.+)$/);
  const norm = wt ? `${wt[1]}/projects/${wt[2]}` : cwd;
  return norm.replace(/[\/._]/g, '-');
}

for (const f of files) {
  totalFiles++;
  let content;
  try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lines = content.split('\n');

  let currentModel = null;
  let currentCwd = null;
  let sessionId = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    totalLines++;
    let obj;
    try { obj = JSON.parse(line); } catch { totalParseErrors++; continue; }
    const ts = obj.timestamp;
    if (!ts) continue;
    const day = dayKey(ts);
    const t = obj.type;
    const p = obj.payload || {};

    if (t === 'session_meta') {
      sessionId = p.id;
      currentCwd = p.cwd;
      // model_provider tells openai vs other, but model name is in turn_context
      if (sessionId) totalSessions.add(sessionId);
    } else if (t === 'turn_context') {
      if (p.model) currentModel = p.model;
      if (p.cwd) currentCwd = p.cwd;
    } else if (t === 'event_msg' && p.type === 'token_count' && p.info && p.info.last_token_usage) {
      const u = p.info.last_token_usage;
      const usage = {
        input: (u.input_tokens || 0) - (u.cached_input_tokens || 0), // uncached input portion
        cached: u.cached_input_tokens || 0,
        output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), // reasoning billed as output
      };
      const model = currentModel || 'unknown';
      if (!pricing.openai_models[model]) unknownModels.add(model);
      totalMessages++;
      const tokens = usage.input + usage.cached + usage.output;
      const projKey = cwdToKey(currentCwd);
      bumpDay(day, sessionId, model, usage, projKey, tokens);
      bumpProject(projKey, sessionId, day, tokens, currentCwd && /\/\.codex\/worktrees\//.test(currentCwd) ? currentCwd : null);
    } else if (t === 'response_item' && p.type === 'message') {
      // Count message events too — gives a messages count without requiring token_count
      // attribution. Doesn't double-count tokens (only token_count events bump usage).
      totalMessages++;
      const projKey = cwdToKey(currentCwd);
      bumpDay(day, sessionId, currentModel, null, projKey, 0);
      bumpProject(projKey, sessionId, day, 0);
    }

    // LOC aggregation — extract per-file additions/deletions from apply_patch
    // custom_tool_call events. Resolves relative paths against currentCwd.
    const locEntries = extractLocFromCodexLine(obj, {
      sessionMeta: { id: sessionId, cwd: currentCwd },
    });
    if (locEntries.length) {
      const projKey = cwdToKey(currentCwd);
      for (const e of locEntries) {
        bumpLoc(e.day, projKey, e.additions, e.deletions);
      }
    }
  }
}

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'codex', dataRoot: DATA_ROOT, sourceHint: '~/.codex/archived_sessions/' });
  process.exit(0);
}

// Aliases + auto-merge via shared git remote (same source as claude builder)
const aliasesCfg = fs.existsSync(ALIASES_PATH) ? JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8')) : { aliases: {} };
const aliasMap = new Map();
for (const [canonical, dirs] of Object.entries(aliasesCfg.aliases || {})) {
  for (const d of dirs) aliasMap.set(d, canonical);
}
const cwdManifestPath = src.cwdManifestPath();
const cwdManifest = cwdManifestPath && fs.existsSync(cwdManifestPath)
  ? JSON.parse(fs.readFileSync(cwdManifestPath, 'utf8'))
  : {};
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
    const canonical = bases.slice().sort((a, b) => a.length - b.length)[0];
    for (const b of bases) m.set(b, canonical);
  }
  return m;
})();
const grouped = new Map();
for (const [name, p] of perProject) {
  const canonical = aliasMap.get(name) || remoteToCanonical.get(name) || name;
  let g = grouped.get(canonical);
  if (!g) { g = { name: canonical, sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0, days: new Set(), archived: false, worktreeDirs: new Set(), mergedFrom: new Set() }; grouped.set(canonical, g); }
  for (const s of p.sessions) g.sessions.add(s);
  g.messages += p.messages;
  g.tokens += p.tokens;
  g.locAdditions += p.locAdditions || 0;
  g.locDeletions += p.locDeletions || 0;
  for (const d of p.days) g.days.add(d);
  for (const w of (p.worktreeDirs || [])) g.worktreeDirs.add(w);
  g.mergedFrom.add(name);
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
  worktrees: p.worktreeDirs.size,
  mergedFrom: [...p.mergedFrom],
  tools: 'codex',
}));

// Emit heatmap with canonicalized byProject — done after aliasMap/remoteToCanonical built.
const codexCanonical = name => aliasMap.get(name) || remoteToCanonical.get(name) || name;
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'codex', ...u });
  const projGroup = new Map();
  for (const [rawName, p] of x.byProject) {
    const canon = codexCanonical(rawName);
    let g = projGroup.get(canon);
    if (!g) { g = { name: canon, sessions: new Set(), messages: 0, tokens: 0, locAdditions: 0, locDeletions: 0 }; projGroup.set(canon, g); }
    for (const s of p.sessions) g.sessions.add(s);
    g.messages += p.messages;
    g.tokens += p.tokens;
    g.locAdditions += p.locAdditions || 0;
    g.locDeletions += p.locDeletions || 0;
  }
  const byProject = [...projGroup.values()]
    .map(g => ({ name: g.name, tool: 'codex', sessions: g.sessions.size, messages: g.messages, tokens: g.tokens, locAdditions: g.locAdditions, locDeletions: g.locDeletions }))
    .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages);
  return { day: d, sessions: x.sessions.size, messages: x.messages, locAdditions: x.locAdditions || 0, locDeletions: x.locDeletions || 0, byModel, byProject };
});

const summary = {
  tool: 'codex',
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

const payload = { summary, heatmap, projects, pricing: codexPricing };

console.log(`Files: ${totalFiles}  Lines: ${totalLines}  Parse errors: ${totalParseErrors}`);
console.log(`Active days: ${activeDays.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
console.log(`Sessions: ${totalSessions.size}  Messages: ${totalMessages}`);
console.log(`LOC: +${totalLocAdditions}  -${totalLocDeletions}  net ${totalLocAdditions - totalLocDeletions}`);
if (unknownModels.size) console.log(`Unknown models (no pricing): ${[...unknownModels].join(', ')}`);

// Quick total cost check
let cost = 0;
for (const d of heatmap) for (const u of d.byModel) {
  const pr = codexPricing.models[u.model]; if (!pr) continue;
  cost += (u.input * pr.input + u.output * pr.output + u.cacheRead * pr.cache_read) / 1e6;
}
console.log(`Total Codex API cost: $${cost.toFixed(2)}`);

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>Codex stats</title>' }));
console.log(`Wrote ${OUT}`);

const aggOut = path.join(DATA_DIR, 'codex-agg.json');
fs.writeFileSync(aggOut, JSON.stringify(payload));
console.log(`Wrote ${aggOut}`);
