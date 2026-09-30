#!/usr/bin/env node
// Aggregate Goose CLI sessions (sqlite-backed) into the dashboard format.
// Source: ~/.local/share/goose/sessions/sessions.db (Linux) or
//   ~/Library/Application Support/Block/goose/sessions/sessions.db (macOS).
// Override via $GOOSE_PATH_ROOT.
//
// Schema is introspected at runtime — Goose has changed columns across releases.
// Best-effort: we look for id / created_at / updated_at / working_dir /
// token_usage / model / description and adapt to what's actually present.
// Model field looks like "provider/model_id" (e.g. "anthropic/claude-sonnet-4").
// token_usage is a JSON blob: {input_tokens, output_tokens, [cache_*]}.
//
// node:sqlite is required (built-in Node 22+). On older runtimes we skip silently
// with a warning so the rest of build-all.sh still completes.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_ROOT, DATA_DIR, ensureDataRoot } = require('./lib/paths');
const { renderTemplate } = require('./lib/render-template');
const { resolveSources } = require('./lib/sources');
const { writeEmptyState } = require('./lib/empty-state');
const { pendingMergesCount } = require('./lib/pending-merges-count');
const { loadMergedPricing } = require('./lib/pricing');

const HOME_PREFIX = os.homedir().replace(/\//g, '-');

ensureDataRoot();
const OUT = path.join(DATA_ROOT, 'goose-dashboard.html');
const pricing = loadMergedPricing();

// node:sqlite is experimental but stable. Behind a try/require so old Node
// installs degrade to empty-state instead of crashing.
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) {
  console.warn(`node:sqlite unavailable (${e.message}); skipping goose dashboard.`);
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: 'requires Node 22+ for node:sqlite' });
  process.exit(0);
}

const src = resolveSources();
const SNAP = src.dir('goose');
if (!SNAP) {
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}
const SNAP_NAME = src.date;

// Goose snapshots the whole sessions/ dir; the sqlite db lives under sessions.db
// at the top level. Look for it (and the older sessions.sqlite filename) recursively
// in case future releases relocate.
function findSqlite(root) {
  const candidates = ['sessions.db', 'sessions.sqlite'];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && candidates.includes(e.name)) return p;
      if (e.isDirectory()) {
        const sub = walk(p);
        if (sub) return sub;
      }
    }
    return null;
  }
  return walk(root);
}
const dbPath = findSqlite(SNAP);
if (!dbPath) {
  console.warn(`No sessions.db under ${SNAP}; emitting empty state.`);
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}
console.log(`Using ${dbPath}`);

let db;
try { db = new DatabaseSync(dbPath, { readOnly: true }); }
catch (e) {
  // Some Node 22 builds don't accept the readOnly option — fall back to default open.
  try { db = new DatabaseSync(dbPath); }
  catch (e2) {
    console.warn(`Failed to open ${dbPath}: ${e2.message}; emitting empty state.`);
    writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
    process.exit(0);
  }
}

// Find the sessions table (might be named sessions, conversations, etc.)
function findSessionsTable() {
  let tables;
  try { tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(); }
  catch { return null; }
  const names = tables.map(t => t.name);
  for (const cand of ['sessions', 'session', 'conversations', 'conversation']) {
    if (names.includes(cand)) return cand;
  }
  // Fall back: first table that looks plausible (has both timestamp + something model-shaped)
  return names[0] || null;
}
const tableName = findSessionsTable();
if (!tableName) {
  console.warn(`No tables in ${dbPath}; emitting empty state.`);
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}

let cols;
try { cols = db.prepare(`PRAGMA table_info("${tableName}")`).all(); }
catch { cols = []; }
const colNames = new Set(cols.map(c => c.name));
console.log(`Table ${tableName} cols: ${[...colNames].join(', ')}`);

// Pick the best-available column for each logical field. Empty when missing.
function pick(...candidates) {
  for (const c of candidates) if (colNames.has(c)) return c;
  return null;
}
const fields = {
  id:        pick('id', 'session_id', 'uuid'),
  created:   pick('created_at', 'created', 'started_at', 'start_time'),
  updated:   pick('updated_at', 'updated', 'last_message_at'),
  cwd:       pick('working_dir', 'cwd', 'workdir', 'working_directory'),
  tokens:    pick('token_usage', 'tokens', 'usage'),
  model:     pick('model', 'model_id', 'model_name'),
  provider:  pick('provider', 'model_provider'),
  desc:      pick('description', 'name', 'title'),
  msgs:      pick('message_count', 'messages', 'n_messages'),
};

// SELECT the columns that exist; alias to canonical names so JS code stays simple.
const selectClauses = [];
for (const [k, col] of Object.entries(fields)) {
  if (col) selectClauses.push(`"${col}" AS "${k}"`);
}
if (!selectClauses.length) {
  console.warn(`No usable columns in ${tableName}; emitting empty state.`);
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}

let rows;
try {
  rows = db.prepare(`SELECT ${selectClauses.join(', ')} FROM "${tableName}"`).all();
} catch (e) {
  console.warn(`Failed to read ${tableName}: ${e.message}; emitting empty state.`);
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}

// Encode a working_dir to the same -Users-... key shape the other parsers use.
function cwdToKey(cwd) {
  if (!cwd) return '-unknown';
  return cwd.replace(/[\/._]/g, '-');
}

// Goose timestamps can be ISO strings, unix seconds, or unix millis. Normalize.
function toDay(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? v.slice(0, 10) : null;
  if (typeof v === 'number' || typeof v === 'bigint') {
    let n = Number(v);
    if (n < 1e12) n *= 1000; // seconds → ms
    return new Date(n).toISOString().slice(0, 10);
  }
  return null;
}

function parseTokens(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function modelKey(row) {
  // Goose stores model as "provider/model_id" — strip the provider prefix so
  // "anthropic/claude-sonnet-4-5" lines up with our pricing.json "claude-sonnet-4-5".
  let m = row.model;
  if (!m) return null;
  if (typeof m !== 'string') m = String(m);
  if (m.includes('/')) m = m.slice(m.lastIndexOf('/') + 1);
  return m || null;
}

const dayKey = ts => ts || null;
const perDay = new Map();
const perProject = new Map();
let totalMessages = 0, totalParseErrors = 0;
const totalSessions = new Set();
const unknownModels = new Set();

function blankUsage() { return { messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 }; }
function blankProjectDay() { return { sessions: new Set(), messages: 0, tokens: 0 }; }

function bumpDay(day, sessionId, model, usage, rawProject, tokens) {
  let d = perDay.get(day);
  if (!d) { d = { sessions: new Set(), messages: 0, byModel: new Map(), byProject: new Map() }; perDay.set(day, d); }
  if (sessionId) d.sessions.add(sessionId);
  const msgCount = usage && usage.messages ? usage.messages : 1;
  d.messages += msgCount;
  if (rawProject) {
    let p = d.byProject.get(rawProject);
    if (!p) { p = blankProjectDay(); d.byProject.set(rawProject, p); }
    if (sessionId) p.sessions.add(sessionId);
    p.messages += msgCount;
    p.tokens += tokens || 0;
  }
  if (!model) return;
  let u = d.byModel.get(model);
  if (!u) { u = blankUsage(); d.byModel.set(model, u); }
  u.messages += msgCount;
  if (usage) {
    u.input += usage.input || 0;
    u.output += usage.output || 0;
    u.cacheRead += usage.cacheRead || 0;
  }
}

function bumpProject(key, sessionId, day, tokens, msgCount) {
  let p = perProject.get(key);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, days: new Set(), archived: false, worktreeDirs: new Set() }; perProject.set(key, p); }
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages += msgCount;
  p.tokens += tokens;
}

// Pricing block — goose can hit Claude or OpenAI models (or others). Merge both.
const gooseModels = { ...(pricing.models || {}), ...(pricing.openai_models || {}) };
// Strip comment keys (pricing.json includes _comment in openai_models).
for (const k of Object.keys(gooseModels)) if (k.startsWith('_')) delete gooseModels[k];

for (const row of rows) {
  const sessionId = row.id != null ? String(row.id) : null;
  if (sessionId) totalSessions.add(sessionId);
  // Prefer created_at for day attribution; fall back to updated_at.
  const day = toDay(row.created) || toDay(row.updated);
  if (!day) { totalParseErrors++; continue; }
  const projectKey = cwdToKey(row.cwd);
  const model = modelKey(row);
  if (model && !gooseModels[model]) unknownModels.add(model);
  const tokens = parseTokens(row.tokens);
  const usage = {
    input: tokens ? (tokens.input_tokens || tokens.input || 0) : 0,
    output: tokens ? (tokens.output_tokens || tokens.output || 0) : 0,
    cacheRead: tokens ? (tokens.cache_read_input_tokens || tokens.cached_input_tokens || tokens.cached || 0) : 0,
    messages: row.msgs ? Number(row.msgs) || 1 : 1,
  };
  const totalTok = usage.input + usage.output + usage.cacheRead;
  totalMessages += usage.messages;
  bumpDay(day, sessionId, model, usage, projectKey, totalTok);
  bumpProject(projectKey, sessionId, day, totalTok, usage.messages);
}

db.close();

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'goose', dataRoot: DATA_ROOT, sourceHint: '~/.local/share/goose/sessions/sessions.db' });
  process.exit(0);
}
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'goose', ...u });
  const byProject = [...x.byProject.entries()]
    .map(([name, p]) => ({ name, tool: 'goose', sessions: p.sessions.size, messages: p.messages, tokens: p.tokens }))
    .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages);
  return { day: d, sessions: x.sessions.size, messages: x.messages, byModel, byProject };
});

const projects = [...perProject.entries()].map(([name, p]) => ({
  name,
  sessions: p.sessions.size,
  messages: p.messages,
  tokens: p.tokens,
  days: [...p.days],
  archived: false,
  worktrees: 0,
  mergedFrom: [name],
  tools: 'goose',
}));

const goosePricing = {
  models: gooseModels,
  subscription: null, // goose is bring-your-own-API-key; no flat subscription
  fastModeMultiplier: { value: 1 },
};

const summary = {
  tool: 'goose',
  snapshot: SNAP_NAME,
  live: src.live,
  generatedAt: new Date().toISOString(),
  totalFiles: 1, // one sqlite db
  totalLines: rows.length,
  totalParseErrors,
  firstDay: activeDays[0] || null,
  lastDay: activeDays[activeDays.length - 1] || null,
  totalSessionsAllTime: totalSessions.size,
  unknownModels: [...unknownModels],
  pendingMergesCount: pendingMergesCount(),
  homePrefix: HOME_PREFIX,
  note: `Source: ${path.basename(dbPath)} (${rows.length} session rows)`,
};

const payload = { summary, heatmap, projects, pricing: goosePricing };

console.log(`Rows: ${rows.length}  Sessions: ${totalSessions.size}  Messages: ${totalMessages}`);
console.log(`Active days: ${activeDays.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
if (unknownModels.size) console.log(`Unknown models (no pricing): ${[...unknownModels].join(', ')}`);

let cost = 0;
for (const d of heatmap) for (const u of d.byModel) {
  const pr = gooseModels[u.model]; if (!pr) continue;
  cost += (u.input * (pr.input || 0) + u.output * (pr.output || 0) + u.cacheRead * (pr.cache_read || 0)) / 1e6;
}
console.log(`Total Goose API cost: $${cost.toFixed(2)}`);

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>Goose CLI stats</title>' }));
console.log(`Wrote ${OUT}`);

const aggOut = path.join(DATA_DIR, 'goose-agg.json');
fs.writeFileSync(aggOut, JSON.stringify(payload));
console.log(`Wrote ${aggOut}`);
