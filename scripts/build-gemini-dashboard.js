#!/usr/bin/env node
// Read latest snapshot's gemini-tmp/ + gemini-history/ — aggregate Gemini CLI usage.
// Gemini CLI layout (snapshotted from ~/.gemini):
//   tmp/<projectName>/.project_root          — absolute filesystem path
//   tmp/<projectName>/chats/session-*.json   — full session: { sessionId, messages[] }
//   tmp/<projectName>/chats/session-*.jsonl  — newer format: header line + one event per line
//   tmp/<projectName>/logs.json              — flat list of user-prompt log entries
//   history/<projectName>/.project_root      — same mapping, older sessions
// Messages have { type: 'user' | 'gemini' | 'tool', timestamp, content/message, model? }.
// No per-message token usage is exposed locally, so we record sessions / messages /
// active days only — costs stay $0 (entries live in pricing.json:gemini_models for
// model-name resolution, but rates are all zero).

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
const OUT = path.join(DATA_ROOT, 'gemini-dashboard.html');
const pricing = loadMergedPricing();

// pricing.json files seeded before gemini support have no gemini_models key.
// Every entry is zero-rate anyway (see the pricing.json comment), so an empty
// table is a correct fallback — and a missing key must not abort the build.
const GEMINI_MODELS = pricing.gemini_models || {};

const src = resolveSources();
const SNAP_NAME = src.date;
// Two dirs hold Gemini data — current tmp (chats/logs) and history.
const presentSources = [
  { root: src.dir('gemini-tmp'), label: 'tmp' },
  { root: src.dir('gemini-history'), label: 'history' },
].filter(s => s.root);
if (!presentSources.length) {
  writeEmptyState(OUT, { tool: 'gemini', dataRoot: DATA_ROOT, sourceHint: '~/.gemini/tmp/<project>/chats/' });
  process.exit(0);
}
console.log(`Using ${src.label} (sources: ${presentSources.map(s => s.label).join(', ')})`);

// Same encoding scheme Claude uses: /Users/example/projects/foo -> -Users-example-projects-foo
// so that gemini + claude + codex projects with the same cwd dedup in the combined view.
function cwdToKey(cwd) {
  if (!cwd) return '-unknown';
  return cwd.replace(/[\/._]/g, '-');
}

const dayKey = ts => (ts || '').slice(0, 10);
const perDay = new Map();
const perProject = new Map();
let totalMessages = 0, totalFiles = 0, totalParseErrors = 0;
const totalSessions = new Set();
const unknownModels = new Set();

function blankUsage() { return { messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 }; }
function blankProjectDay() { return { sessions: new Set(), messages: 0, tokens: 0 }; }

function bumpDay(day, sessionId, model, rawProject) {
  let d = perDay.get(day);
  if (!d) { d = { sessions: new Set(), messages: 0, byModel: new Map(), byProject: new Map() }; perDay.set(day, d); }
  if (sessionId) d.sessions.add(sessionId);
  d.messages++;
  if (rawProject) {
    let p = d.byProject.get(rawProject);
    if (!p) { p = blankProjectDay(); d.byProject.set(rawProject, p); }
    if (sessionId) p.sessions.add(sessionId);
    p.messages++;
    // Gemini exposes no token counts — leave at 0.
  }
  if (!model) return;
  let u = d.byModel.get(model);
  if (!u) { u = blankUsage(); d.byModel.set(model, u); }
  u.messages++;
  // No token usage available — leave input/output/cache at 0.
}

function bumpProject(key, sessionId, day) {
  let p = perProject.get(key);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, days: new Set(), archived: false, worktreeDirs: new Set() }; perProject.set(key, p); }
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages++;
}

// Resolve a project dir under tmp/ or history/ to its canonical key.
// .project_root holds the absolute path; if missing fall back to the dir name itself.
function resolveProjectKey(projectDir) {
  const rootFile = path.join(projectDir, '.project_root');
  let cwd = null;
  if (fs.existsSync(rootFile)) {
    try { cwd = fs.readFileSync(rootFile, 'utf8').trim(); } catch {}
  }
  if (cwd) return cwdToKey(cwd);
  // No project_root: synthesize a key from the bare dir name so it doesn't collide
  // with the "no cwd known" bucket.
  return cwdToKey('/gemini-unknown/' + path.basename(projectDir));
}

function recordMessage({ projectKey, sessionId, model, timestamp }) {
  const day = dayKey(timestamp);
  if (!day) return;
  if (sessionId) totalSessions.add(sessionId);
  totalMessages++;
  bumpDay(day, sessionId, model, projectKey);
  bumpProject(projectKey, sessionId, day);
}

// Map a non-user message without an explicit model field to a synthetic
// model only if it represents an assistant reply (type=gemini). Tool-result
// events stay model-less so they don't pollute the byModel breakdown — mirrors
// how the Claude builder skips lines without `msg.model`.
function pickModel(m) {
  if (m.model) return m.model;
  if (m.type === 'gemini') return 'gemini-unknown';
  return null;
}

// Parse a full-session JSON file (older format): { sessionId, messages: [...] }
function parseChatJson(file, projectKey) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  let doc;
  try { doc = JSON.parse(raw); } catch { totalParseErrors++; return; }
  const sessionId = doc.sessionId || null;
  const messages = doc.messages || [];
  for (const m of messages) {
    const model = pickModel(m);
    if (model && !GEMINI_MODELS[model]) unknownModels.add(model);
    recordMessage({ projectKey, sessionId, model, timestamp: m.timestamp });
  }
}

// Parse a JSONL session (newer format): first line is the session header
// ({ sessionId, projectHash, startTime, ... }), subsequent lines are individual
// events. Many lines are `$set` partial-state updates — skip those.
function parseChatJsonl(file, projectKey) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  let sessionId = null;
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { totalParseErrors++; continue; }
    // Header line — has sessionId, projectHash, startTime but no `type`.
    if (obj.sessionId && obj.projectHash && !obj.type && !obj.$set) {
      sessionId = obj.sessionId;
      continue;
    }
    // $set entries are partial state updates (lastUpdated bumps) — not messages.
    if (obj.$set) continue;
    if (!obj.type) continue; // unknown event kind
    const model = pickModel(obj);
    if (model && !GEMINI_MODELS[model]) unknownModels.add(model);
    recordMessage({ projectKey, sessionId, model, timestamp: obj.timestamp });
  }
}

// Parse a logs.json file: flat array of { sessionId, messageId, type, message, timestamp }.
// Logs typically contain only user prompts (tool persists them separately from chats/).
function parseLogsJson(file, projectKey) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  let arr;
  try { arr = JSON.parse(raw); } catch { totalParseErrors++; return; }
  if (!Array.isArray(arr)) return;
  for (const entry of arr) {
    const model = entry.model || null;
    if (model && !GEMINI_MODELS[model]) unknownModels.add(model);
    recordMessage({
      projectKey,
      sessionId: entry.sessionId || null,
      model,
      timestamp: entry.timestamp,
    });
  }
}

for (const src of presentSources) {
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(src.root, { withFileTypes: true }).filter(e => e.isDirectory());
  } catch { continue; }
  for (const pd of projectDirs) {
    const projectDir = path.join(src.root, pd.name);
    const projectKey = resolveProjectKey(projectDir);

    // chats/ — per-session files in either .json or .jsonl format
    const chatsDir = path.join(projectDir, 'chats');
    if (fs.existsSync(chatsDir)) {
      let chatFiles;
      try { chatFiles = fs.readdirSync(chatsDir); } catch { chatFiles = []; }
      for (const name of chatFiles) {
        const full = path.join(chatsDir, name);
        if (name.endsWith('.json')) { totalFiles++; parseChatJson(full, projectKey); }
        else if (name.endsWith('.jsonl')) { totalFiles++; parseChatJsonl(full, projectKey); }
      }
    }

    // logs.json — flat prompt log (only in tmp/, not history/)
    const logsFile = path.join(projectDir, 'logs.json');
    if (fs.existsSync(logsFile)) {
      totalFiles++;
      parseLogsJson(logsFile, projectKey);
    }
  }
}

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'gemini', dataRoot: DATA_ROOT, sourceHint: '~/.gemini/tmp/<project>/chats/' });
  process.exit(0);
}
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'gemini', ...u });
  const byProject = [...x.byProject.entries()]
    .map(([name, p]) => ({ name, tool: 'gemini', sessions: p.sessions.size, messages: p.messages, tokens: p.tokens }))
    .sort((a, b) => b.messages - a.messages);
  return { day: d, sessions: x.sessions.size, messages: x.messages, byModel, byProject };
});

const projects = [...perProject.entries()].map(([name, p]) => ({
  name,
  sessions: p.sessions.size,
  messages: p.messages,
  tokens: 0,
  days: [...p.days],
  archived: false,
  worktrees: 0,
  mergedFrom: [name],
  tools: 'gemini',
}));

// Pricing block shaped like the others so the template's cost math runs (and returns 0).
// gemini_models all have zero rates — see pricing.json comment for the TODO.
const geminiPricing = {
  models: { ...GEMINI_MODELS },
  subscription: null, // Gemini CLI does not have a per-machine subscription concept in vibestats yet
  fastModeMultiplier: { value: 1 },
};

const summary = {
  tool: 'gemini',
  snapshot: SNAP_NAME,
  live: src.live,
  generatedAt: new Date().toISOString(),
  totalFiles,
  totalLines: totalMessages, // no concept of "lines" here — keep field for template compat
  totalParseErrors,
  firstDay: activeDays[0] || null,
  lastDay: activeDays[activeDays.length - 1] || null,
  totalSessionsAllTime: totalSessions.size,
  unknownModels: [...unknownModels],
  pendingMergesCount: pendingMergesCount(),
  homePrefix: HOME_PREFIX,
  note: 'Gemini CLI does not expose per-message token counts. Costs render as $0.',
};

const payload = { summary, heatmap, projects, pricing: geminiPricing };

console.log(`Files: ${totalFiles}  Parse errors: ${totalParseErrors}`);
console.log(`Active days: ${activeDays.length}  Range: ${summary.firstDay} → ${summary.lastDay}`);
console.log(`Sessions: ${totalSessions.size}  Messages: ${totalMessages}`);
if (unknownModels.size) console.log(`Unknown models (no pricing entry): ${[...unknownModels].join(', ')}`);

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>Gemini CLI stats</title>' }));
console.log(`Wrote ${OUT}`);

const aggOut = path.join(DATA_DIR, 'gemini-agg.json');
fs.writeFileSync(aggOut, JSON.stringify(payload));
console.log(`Wrote ${aggOut}`);
