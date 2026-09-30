#!/usr/bin/env node
// Aggregate claude.ai web chat history (fetched by fetch-claude-web.js) into
// the dashboard format. The web API does NOT return per-message token usage,
// so cost is estimated from message count × avg-tokens heuristic.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_ROOT, SNAP_ROOT, DATA_DIR, ensureDataRoot } = require('./lib/paths');
const { renderTemplate } = require('./lib/render-template');
const { writeEmptyState } = require('./lib/empty-state');
const { loadMergedPricing } = require('./lib/pricing');

const HOME_PREFIX = os.homedir().replace(/\//g, '-');

ensureDataRoot();
const OUT = path.join(DATA_ROOT, 'claude-web-dashboard.html');
const pricing = loadMergedPricing();
const snapDirs = fs.existsSync(SNAP_ROOT)
  ? fs.readdirSync(SNAP_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  : [];
if (!snapDirs.length) {
  writeEmptyState(OUT, { tool: 'claude-web', dataRoot: DATA_ROOT, sourceHint: 'snapshots/<date>/claude-web/ (run `vibestats fetch-web` first)' });
  process.exit(0);
}
const SNAP_NAME = snapDirs[snapDirs.length - 1];
const SNAP = path.join(SNAP_ROOT, SNAP_NAME, 'claude-web');
if (!fs.existsSync(SNAP)) {
  console.error(`No claude-web data in ${SNAP_NAME}. Run scripts/fetch-claude-web.js first.`);
  writeEmptyState(OUT, { tool: 'claude-web', dataRoot: DATA_ROOT, sourceHint: 'snapshots/<date>/claude-web/ (run `vibestats fetch-web` first)' });
  process.exit(0);
}
console.log(`Using ${SNAP}`);

// Heuristic: average per-message tokens. Web chats tend to be shorter than coding sessions.
// Used only for cost estimate. Adjust in pricing.json if you want different defaults.
const AVG_INPUT_PER_MSG = 1200;
const AVG_OUTPUT_PER_MSG = 600;

const dayKey = ts => ts.slice(0, 10);
const perDay = new Map();
const perProject = new Map();
let totalConvos = 0, totalMsgs = 0;

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
    p.tokens += AVG_INPUT_PER_MSG + AVG_OUTPUT_PER_MSG;
  }
  const m = model || 'unknown';
  let u = d.byModel.get(m);
  if (!u) { u = blankUsage(); d.byModel.set(m, u); }
  u.messages++;
  u.input += AVG_INPUT_PER_MSG;
  u.output += AVG_OUTPUT_PER_MSG;
}

function bumpProject(name, sessionId, day) {
  let p = perProject.get(name);
  if (!p) { p = { sessions: new Set(), messages: 0, tokens: 0, days: new Set() }; perProject.set(name, p); }
  if (sessionId) p.sessions.add(sessionId);
  if (day) p.days.add(day);
  p.messages++;
  p.tokens += AVG_INPUT_PER_MSG + AVG_OUTPUT_PER_MSG;
}

// Walk all org dirs and process per-conversation JSONs
const orgDirs = fs.readdirSync(SNAP, { withFileTypes: true }).filter(e => e.isDirectory());
for (const orgEnt of orgDirs) {
  const orgDir = path.join(SNAP, orgEnt.name);
  const files = fs.readdirSync(orgDir).filter(n => n.endsWith('.json') && !n.startsWith('_'));
  for (const f of files) {
    totalConvos++;
    let convo;
    try { convo = JSON.parse(fs.readFileSync(path.join(orgDir, f), 'utf8')); } catch { continue; }
    const sessionId = convo.uuid;
    // Project: web chats don't have a cwd. Use convo.project.name if present, else a synthetic bucket.
    const projectName = (convo.project && (convo.project.name || convo.project.uuid)) || 'web-chat';
    const messages = convo.chat_messages || [];
    if (!messages.length) continue;
    for (const m of messages) {
      const ts = m.created_at;
      if (!ts) continue;
      const day = dayKey(ts);
      const model = m.model || convo.model || 'claude-web-unknown';
      bumpDay(day, sessionId, model, 'web-' + projectName);
      bumpProject('web-' + projectName, sessionId, day);
      totalMsgs++;
    }
  }
}

const activeDays = [...perDay.keys()].sort();
if (!activeDays.length) {
  writeEmptyState(OUT, { tool: 'claude-web', dataRoot: DATA_ROOT, sourceHint: 'snapshots/<date>/claude-web/' });
  process.exit(0);
}
const heatmap = activeDays.map(d => {
  const x = perDay.get(d);
  const byModel = [];
  for (const [m, u] of x.byModel) byModel.push({ model: m, tool: 'claude-web', ...u });
  const byProject = [...x.byProject.entries()]
    .map(([name, p]) => ({ name, tool: 'claude-web', sessions: p.sessions.size, messages: p.messages, tokens: p.tokens }))
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
  tools: 'claude-web',
}));

// Build a pricing block that maps web-detected model names to Claude pricing.
// Most web chats use Sonnet / Opus families.
const webPricing = {
  models: {},
  subscription: pricing.subscription, // share the Claude subscription
  fastModeMultiplier: { value: 1 },
};
for (const [k, v] of Object.entries(pricing.models)) webPricing.models[k] = v;
// Catch-all for unknown web model strings — assume Sonnet-tier
webPricing.models['claude-web-unknown'] = pricing.models['claude-sonnet-4-6'] || { input: 3, cache_5m: 0, cache_1h: 0, cache_read: 0.3, output: 15 };

const summary = {
  tool: 'claude-web',
  snapshot: SNAP_NAME,
  generatedAt: new Date().toISOString(),
  firstDay: activeDays[0] || null,
  lastDay: activeDays[activeDays.length - 1] || null,
  totalSessionsAllTime: totalConvos,
  totalFiles: totalConvos,
  totalLines: totalMsgs,
  totalParseErrors: 0,
  unknownModels: [],
  homePrefix: HOME_PREFIX,
  note: `Web API exposes no token counts. Costs estimated from ${AVG_INPUT_PER_MSG} input + ${AVG_OUTPUT_PER_MSG} output tokens per message.`,
};

const payload = { summary, heatmap, projects, pricing: webPricing };

console.log(`Conversations: ${totalConvos}  Messages: ${totalMsgs}  Active days: ${activeDays.length}`);
console.log(`Range: ${summary.firstDay} → ${summary.lastDay}`);

fs.writeFileSync(OUT, renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>Claude.ai web chats</title>' }));
console.log(`Wrote ${OUT}`);

fs.writeFileSync(path.join(DATA_DIR, 'claude-web-agg.json'), JSON.stringify(payload));
console.log(`Wrote data/claude-web-agg.json`);
