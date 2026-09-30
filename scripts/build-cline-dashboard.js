#!/usr/bin/env node
// Aggregate Cline-family extension tasks (Cline / Roo Code / KiloCode) into
// the dashboard format. Source: VS Code + Cursor globalStorage per-extension
// task directories, snapshotted into:
//   snapshots/<date>/cline/<host>/<extension>/tasks/<taskId>/ui_messages.json
//
// ui_messages.json is an array of events. Cost + token attribution comes from
// entries with type='say' AND say='api_req_started' — their `text` is a JSON-
// encoded blob like:
//   { cost: 0.123, tokensIn: 1500, tokensOut: 300, cacheReads: 200,
//     cacheWrites: 0, request: "...", response: "..." }
// Some payloads also carry an "apiProtocol" + "modelId" hint; we use modelId
// when present and fall back to a per-extension synthetic name.

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
const OUT = path.join(DATA_ROOT, 'cline-dashboard.html');
const pricing = loadMergedPricing();

const src = resolveSources();
const SNAP_NAME = src.date;
// [{ tasksDir, ext }] — snapshot mode walks <date>/cline/<host>/<ext>/tasks,
// live mode walks the VS Code / Cursor globalStorage dirs directly.
const taskRoots = src.clineTaskDirs();
if (!taskRoots.length) {
  writeEmptyState(OUT, { tool: 'cline', dataRoot: DATA_ROOT, sourceHint: 'VS Code/Cursor globalStorage tasks/' });
  process.exit(0);
}
console.log(`Using ${src.label} (${taskRoots.length} cline task dirs)`);

const EXT_NAMES = {
  'saoudrizwan.claude-dev': 'cline',
  'rooveterinaryinc.roo-cline': 'roo',
  'kilocode': 'kilo',
};
function extLabel(ext) { return EXT_NAMES[ext] || ext; }

// Project key from a Cline task's cwd, matching the encoding the other parsers use.
function cwdToKey(cwd) {
  if (!cwd) return '-unknown';
  return cwd.replace(/[\/._]/g, '-');
}

const dayKey = ts => ts ? ts.slice(0, 10) : null;
const perDay = new Map();
const perProject = new Map();
let totalTasks = 0, totalEvents = 0, totalParseErrors = 0;
const totalSessions = new Set();
const unknownModels = new Set();
let directCostSum = 0; // sum of `cost` fields if present — useful sanity vs pricing math

function blankUsage() { return { messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 }; }
function blankProjectDay() { return { sessions: new Set(), messages: 0, tokens: 0 }; }

function bumpDay(day, sessionId, model, usage, rawProject, tokens) {
  let d = perDay.get(day);
  if (!d) { d = { sessions: new Set(), messages: 0, byModel: new Map(), byProject: new Map() }; perDay.set(day, d); }
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
  u.input += usage.input || 0;
  u.output += usage.output || 0;
  u.cacheRead += usage.cacheRead || 0;
  u.cacheCreate5m += usage.cacheCreate || 0;
}

function bumpProject(key, sessionId, day, tokens) {
  let p = perProject.get(key);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, days: new Set(), archived: false }; perProject.set(key, p); }
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages++;
  p.tokens += tokens;
}

// Try to lift a project cwd off non-api_req events that sometimes carry it.
// Cline writes a `cwd` field on the initial `say.task` event in newer versions.
function findCwd(events) {
  for (const e of events) {
    if (typeof e !== 'object' || !e) continue;
    if (e.cwd) return e.cwd;
    // text may be JSON for some kinds
    if (typeof e.text === 'string' && e.text.startsWith('{')) {
      try {
        const blob = JSON.parse(e.text);
        if (blob && blob.cwd) return blob.cwd;
      } catch {}
    }
  }
  return null;
}

// Map a Cline-reported modelId (e.g. "claude-sonnet-4-5-20250929", "gpt-5") to a
// pricing key we have. Strips trailing dated suffixes that pricing.json doesn't carry.
function normalizeModel(m) {
  if (!m) return null;
  if (typeof m !== 'string') m = String(m);
  // First match on exact name in any pricing table — keeps dated variants intact when present.
  if (pricing.models[m] || pricing.openai_models[m] || (pricing.gemini_models && pricing.gemini_models[m])) return m;
  // Strip trailing `-YYYYMMDD` (Anthropic dated model suffix).
  const stripped = m.replace(/-\d{8}$/, '');
  if (pricing.models[stripped] || pricing.openai_models[stripped]) return stripped;
  return m;
}

function processTaskDir(taskDir, ext) {
  const uiPath = path.join(taskDir, 'ui_messages.json');
  if (!fs.existsSync(uiPath)) return;
  let raw;
  try { raw = fs.readFileSync(uiPath, 'utf8'); } catch { return; }
  let events;
  try { events = JSON.parse(raw); } catch { totalParseErrors++; return; }
  if (!Array.isArray(events)) return;

  const sessionId = path.basename(taskDir); // taskId
  totalSessions.add(sessionId);
  totalTasks++;

  const cwd = findCwd(events);
  const projectKey = cwdToKey(cwd);

  for (const ev of events) {
    totalEvents++;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type !== 'say' || ev.say !== 'api_req_started') continue;
    let blob;
    try { blob = typeof ev.text === 'string' ? JSON.parse(ev.text) : ev.text; }
    catch { totalParseErrors++; continue; }
    if (!blob || typeof blob !== 'object') continue;

    const ts = ev.ts || ev.timestamp || blob.startedAt || null;
    // ts may be epoch millis (Cline's default) or ISO. Normalize.
    let day = null;
    if (typeof ts === 'number') day = new Date(ts).toISOString().slice(0, 10);
    else if (typeof ts === 'string') day = ts.slice(0, 10);
    if (!day) continue;

    const modelRaw = blob.modelId || blob.model || ext + '-unknown';
    const model = normalizeModel(modelRaw);
    if (model && !pricing.models[model] && !pricing.openai_models[model]) unknownModels.add(model);

    const usage = {
      input: Number(blob.tokensIn) || 0,
      output: Number(blob.tokensOut) || 0,
      cacheRead: Number(blob.cacheReads) || 0,
      cacheCreate: Number(blob.cacheWrites) || 0,
    };
    if (typeof blob.cost === 'number' && isFinite(blob.cost)) directCostSum += blob.cost;
    const totalTok = usage.input + usage.output + usage.cacheRead + usage.cacheCreate;
    bumpDay(day, sessionId, model, usage, projectKey, totalTok);
    bumpProject(projectKey, sessionId, day, totalTok);
  }
}

// Each root is a .../tasks dir holding one dir per task.
function walkTaskRoots() {
  for (const { tasksDir, ext } of taskRoots) {
    let tasks;
    try { tasks = fs.readdirSync(tasksDir, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { continue; }
    for (const t of tasks) {
      processTaskDir(path.join(tasksDir, t.name), extLabel(ext));
    }
  }
}
walkTaskRoots();

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'cline', dataRoot: DATA_ROOT, sourceHint: 'VS Code/Cursor globalStorage tasks/' });
  process.exit(0);
}
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'cline', ...u });
  const byProject = [...x.byProject.entries()]
    .map(([name, p]) => ({ name, tool: 'cline', sessions: p.sessions.size, messages: p.messages, tokens: p.tokens }))
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
  tools: 'cline',
}));

// Merge Claude + OpenAI pricing so the template can cost both providers.
const mergedModels = { ...(pricing.models || {}), ...(pricing.openai_models || {}) };
for (const k of Object.keys(mergedModels)) if (k.startsWith('_')) delete mergedModels[k];

const clinePricing = {
  models: mergedModels,
  subscription: null, // Cline-family is bring-your-own-key; no flat subscription
  fastModeMultiplier: { value: 1 },
};

const summary = {
  tool: 'cline',
  snapshot: SNAP_NAME,
  live: src.live,
  generatedAt: new Date().toISOString(),
  totalFiles: totalTasks,
  totalLines: totalEvents,
  totalParseErrors,
  firstDay: activeDays[0] || null,
  lastDay: activeDays[activeDays.length - 1] || null,
  totalSessionsAllTime: totalSessions.size,
  unknownModels: [...unknownModels],
  pendingMergesCount: pendingMergesCount(),
  homePrefix: HOME_PREFIX,
  directCostSum, // what Cline itself reported in `cost` fields — sanity vs pricing math
};

const payload = { summary, heatmap, projects, pricing: clinePricing };

console.log(`Tasks: ${totalTasks}  Events: ${totalEvents}  Parse errors: ${totalParseErrors}`);
console.log(`Active days: ${activeDays.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
console.log(`Sessions: ${totalSessions.size}`);
if (unknownModels.size) console.log(`Unknown models (no pricing): ${[...unknownModels].join(', ')}`);

let computedCost = 0;
for (const d of heatmap) for (const u of d.byModel) {
  const pr = mergedModels[u.model]; if (!pr) continue;
  computedCost += (u.input * (pr.input || 0)
                + u.output * (pr.output || 0)
                + u.cacheRead * (pr.cache_read || 0)
                + u.cacheCreate5m * (pr.cache_5m || pr.cache_read || 0)) / 1e6;
}
console.log(`Computed Cline API cost: $${computedCost.toFixed(2)}  (Cline-reported sum: $${directCostSum.toFixed(2)})`);

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>Cline family stats</title>' }));
console.log(`Wrote ${OUT}`);

const aggOut = path.join(DATA_DIR, 'cline-agg.json');
fs.writeFileSync(aggOut, JSON.stringify(payload));
console.log(`Wrote ${aggOut}`);
