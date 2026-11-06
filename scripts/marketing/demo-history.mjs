#!/usr/bin/env node
// Writes a fictional usage history for screenshots and marketing images.
//
//   node scripts/marketing/demo-history.mjs <empty-data-dir>
//
// The output is a vibestats data dir (pricing.json, project-aliases.json and
// one dated snapshot) whose Claude Code, Codex and Gemini CLI transcripts are
// generated from a fixed seed. Every project, path, prompt and number is
// invented. Nothing here reads ~/.claude, ~/.codex, ~/.gemini or ~/.vibestats.
// Point the normal builders at the result with VIBESTATS_DATA_DIR (and
// HOME=/home/demo so project names render without a home prefix).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_HOME = '/home/demo';
export const SNAPSHOT_DATE = '2026-10-31';
const FIRST_DAY = '2026-01-05';

// ---- seeded randomness: same seed, same history -----------------------------
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261031);
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const chance = p => rand() < p;
function pickWeighted(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rand() * total;
  for (const it of items) { r -= it.weight; if (r <= 0) return it; }
  return items[items.length - 1];
}
function uuid() {
  const h = () => Math.floor(rand() * 16).toString(16);
  const s = n => Array.from({ length: n }, h).join('');
  return `${s(8)}-${s(4)}-4${s(3)}-a${s(3)}-${s(12)}`;
}

// ---- the fictional world ----------------------------------------------------
// from/to are inclusive months (1 = January). archived projects land in
// projects-archive/, the way Claude Code rotates old project dirs.
const CLAUDE_PROJECTS = [
  { name: 'tidepool-app', from: 1, to: 10, weight: 5, worktrees: ['dark-mode', 'offline-cache', 'billing-page'] },
  { name: 'orbit-notes', from: 1, to: 4, weight: 3 },
  { name: 'recipe-box', from: 1, to: 3, weight: 2, archived: true },
  { name: 'bookshelf-v1', from: 1, to: 2, weight: 1.5, archived: true },
  { name: 'ledger-cli', from: 2, to: 7, weight: 2 },
  { name: 'kite-weather', from: 3, to: 6, weight: 2 },
  { name: 'quill-blog', from: 1, to: 10, weight: 1 },
  { name: 'mosaic-ui', from: 4, to: 10, weight: 1.5 },
  { name: 'trailmap', from: 5, to: 10, weight: 3 },
  { name: 'atlas-api', from: 6, to: 10, weight: 3, worktrees: ['rate-limits', 'search-v2'] },
  { name: 'sundial-timer', from: 7, to: 9, weight: 1.5 },
  { name: 'harbor-sync', from: 8, to: 10, weight: 2.5 },
  { name: 'fern-docs', from: 9, to: 10, weight: 1.5 },
];
const CODEX_PROJECTS = [
  { name: 'atlas-api', from: 6, to: 10, weight: 3 },
  { name: 'ledger-cli', from: 3, to: 7, weight: 2 },
  { name: 'harbor-sync', from: 8, to: 10, weight: 2 },
  { name: 'trailmap', from: 5, to: 10, weight: 1.5 },
  { name: 'lumen-cli', from: 4, to: 10, weight: 2 },
];
const GEMINI_PROJECTS = [
  { name: 'fern-docs', from: 9, to: 10, weight: 2 },
  { name: 'kite-weather', from: 5, to: 6, weight: 1 },
  { name: 'quill-blog', from: 5, to: 10, weight: 1 },
];
const claudeModelFor = m => (m <= 3 ? ['claude-sonnet-4-5', 'claude-opus-4-5']
  : m <= 7 ? ['claude-opus-4-6', 'claude-sonnet-4-6']
  : ['claude-opus-4-7', 'claude-sonnet-4-6']);
const codexModelFor = m => (m <= 5 ? 'gpt-5-codex' : m <= 8 ? 'gpt-5.4' : 'gpt-5.5');
const geminiModelFor = m => (m <= 6 ? 'gemini-2.5-pro' : 'gemini-3-pro');

// A two-week break in August, a gentle ramp over the year, quieter weekends.
const BREAK = ['2026-08-10', '2026-08-23'];
function dayActivity(date) {
  const iso = date.toISOString().slice(0, 10);
  if (iso >= BREAK[0] && iso <= BREAK[1]) return 0;
  const dow = date.getUTCDay();
  const month = date.getUTCMonth() + 1;
  const ramp = 0.55 + month * 0.08;
  // The last three weeks are all active, so the current streak is visible.
  if (iso >= '2026-10-11') return ramp * (dow === 0 || dow === 6 ? 0.5 : 1);
  const p = dow === 0 ? 0.3 : dow === 6 ? 0.45 : 0.88;
  return chance(p) ? ramp * (dow === 0 || dow === 6 ? 0.5 : 1) : 0;
}

const projectsIn = (list, month) => list.filter(p => month >= p.from && month <= p.to);
const encode = cwd => cwd.replace(/[/._]/g, '-');
const ts = (date, minutes) => new Date(date.getTime() + minutes * 60000).toISOString();

// ---- writers ----------------------------------------------------------------
function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, body, { mode: 0o600 });
}

function claudeSession(day, startMin, project, month) {
  const sessionId = uuid();
  const cwd = `${DEMO_HOME}/projects/${project.name}`;
  const [mainModel, sideModel] = claudeModelFor(month);
  const lines = [];
  let t = startMin;
  const turns = intBetween(3, 16);
  for (let turn = 0; turn < turns; turn++) {
    lines.push({ type: 'user', uuid: uuid(), timestamp: ts(day, t), sessionId, cwd,
      message: { role: 'user', content: 'Fictional prompt for the demo history.' } });
    const steps = intBetween(2, 7);
    for (let s = 0; s < steps; s++) {
      t += between(0.2, 2.5);
      const model = chance(0.82) ? mainModel : sideModel;
      const c1h = chance(0.25) ? intBetween(500, 6000) : 0;
      const c5m = intBetween(300, 9000);
      lines.push({ type: 'assistant', uuid: uuid(), timestamp: ts(day, t), sessionId,
        message: { id: 'msg_demo_' + uuid().slice(0, 8), role: 'assistant', model,
          content: [{ type: 'text', text: 'Fictional reply.' }],
          usage: {
            input_tokens: intBetween(3, 60),
            output_tokens: intBetween(120, 1800),
            cache_read_input_tokens: intBetween(18000, 140000),
            cache_creation_input_tokens: c5m + c1h,
            cache_creation: { ephemeral_5m_input_tokens: c5m, ephemeral_1h_input_tokens: c1h },
          } } });
      if (s < steps - 1) {
        t += between(0.1, 1.5);
        const result = { type: 'user', uuid: uuid(), timestamp: ts(day, t), sessionId, cwd,
          message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } };
        if (chance(0.3)) {
          const adds = intBetween(1, 48), dels = intBetween(0, Math.min(30, adds + 6));
          result.toolUseResult = {
            filePath: `${cwd}/src/module-${intBetween(1, 40)}.ts`,
            structuredPatch: [{ oldStart: 1, oldLines: dels, newStart: 1, newLines: adds,
              lines: [...Array(dels).fill('-old line'), ...Array(adds).fill('+new line')] }],
          };
        }
        lines.push(result);
      }
    }
    t += between(1, 9);
  }
  return { sessionId, body: lines.map(l => JSON.stringify(l)).join('\n') + '\n', endMin: t };
}

function codexSession(day, startMin, project, month) {
  const id = uuid();
  const cwd = `${DEMO_HOME}/projects/${project.name}`;
  const model = codexModelFor(month);
  const lines = [{ timestamp: ts(day, startMin), type: 'session_meta',
    payload: { id, cwd, originator: 'codex_cli_rs', cli_version: '0.0.0-demo', model_provider: 'openai' } },
  { timestamp: ts(day, startMin), type: 'turn_context', payload: { model, cwd } }];
  let t = startMin;
  const turns = intBetween(2, 10);
  for (let i = 0; i < turns; i++) {
    t += between(0.5, 4);
    lines.push({ timestamp: ts(day, t), type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fictional prompt.' }] } });
    const calls = intBetween(1, 5);
    for (let c = 0; c < calls; c++) {
      t += between(0.2, 2);
      const input = intBetween(12000, 90000);
      lines.push({ timestamp: ts(day, t), type: 'event_msg', payload: { type: 'token_count', info: {
        last_token_usage: { input_tokens: input, cached_input_tokens: Math.floor(input * between(0.6, 0.92)),
          output_tokens: intBetween(150, 1600), reasoning_output_tokens: intBetween(40, 900) } } } });
    }
    lines.push({ timestamp: ts(day, t), type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fictional reply.' }] } });
  }
  const stamp = ts(day, startMin).slice(0, 19).replace(/:/g, '-');
  return { name: `rollout-${stamp}-${id}.jsonl`, body: lines.map(l => JSON.stringify(l)).join('\n') + '\n' };
}

function geminiSession(day, startMin, month) {
  const sessionId = uuid();
  const model = geminiModelFor(month);
  const messages = [];
  let t = startMin;
  for (let i = 0, n = intBetween(3, 12); i < n; i++) {
    t += between(0.5, 3);
    messages.push({ type: 'user', timestamp: ts(day, t), content: 'Fictional prompt.' });
    t += between(0.2, 1.5);
    messages.push({ type: 'gemini', timestamp: ts(day, t), model, content: 'Fictional reply.' });
  }
  return { sessionId, messages };
}

// ---- main -------------------------------------------------------------------
export function writeDemoHistory(dataDir) {
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
    throw new Error(`${dataDir} is not empty. Pass a new, empty directory.`);
  }
  const snap = path.join(dataDir, 'snapshots', SNAPSHOT_DATE);

  const pricing = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, 'pricing.example.json'), 'utf8'));
  pricing._comment = 'Fictional demo data dir written by scripts/marketing/demo-history.mjs.';
  pricing.subscription = { tier: 'Max 5x', monthly_usd: 100, started: FIRST_DAY, _autoDetected: false };
  pricing.codex_subscription = { tier: 'ChatGPT Plus', monthly_usd: 20, started: '2026-03-02', _autoDetected: false };
  writeFile(path.join(dataDir, 'pricing.json'), JSON.stringify(pricing, null, 2) + '\n');
  writeFile(path.join(dataDir, 'project-aliases.json'), JSON.stringify({ aliases: {} }, null, 2) + '\n');

  const counts = { days: 0, claudeSessions: 0, codexSessions: 0, geminiSessions: 0 };
  const geminiByProject = new Map();
  const end = new Date(SNAPSHOT_DATE + 'T00:00:00Z');
  for (let day = new Date(FIRST_DAY + 'T00:00:00Z'); day <= end; day = new Date(day.getTime() + 86400000)) {
    const level = dayActivity(day);
    if (!level) continue;
    counts.days++;
    const month = day.getUTCMonth() + 1;

    let minute = intBetween(7 * 60, 10 * 60);
    const sessions = Math.max(1, Math.round(between(1, 6) * level));
    for (let i = 0; i < sessions; i++) {
      const project = pickWeighted(projectsIn(CLAUDE_PROJECTS, month));
      const worktree = project.worktrees && chance(0.3)
        ? project.worktrees[intBetween(0, project.worktrees.length - 1)] : null;
      const dir = encode(`${DEMO_HOME}/projects/${project.name}`) + (worktree ? `--claude-worktrees-${worktree}` : '');
      const s = claudeSession(day, minute, project, month);
      writeFile(path.join(snap, project.archived ? 'projects-archive' : 'projects', dir, `${s.sessionId}.jsonl`), s.body);
      counts.claudeSessions++;
      minute = Math.min(s.endMin + intBetween(10, 90), 23 * 60);
    }

    if (month >= 3 && chance(0.38 * level + 0.05)) {
      for (let i = 0, n = intBetween(1, 3); i < n; i++) {
        const project = pickWeighted(projectsIn(CODEX_PROJECTS, month));
        const s = codexSession(day, intBetween(9 * 60, 21 * 60), project, month);
        writeFile(path.join(snap, 'codex-sessions', s.name), s.body);
        counts.codexSessions++;
      }
    }

    if (month >= 5 && chance(0.12)) {
      const project = pickWeighted(projectsIn(GEMINI_PROJECTS, month));
      const s = geminiSession(day, intBetween(9 * 60, 20 * 60), month);
      if (!geminiByProject.has(project.name)) geminiByProject.set(project.name, []);
      geminiByProject.get(project.name).push(s);
      counts.geminiSessions++;
    }
  }

  for (const [name, sessions] of geminiByProject) {
    const dir = path.join(snap, 'gemini-tmp', `demo-${name}`);
    writeFile(path.join(dir, '.project_root'), `${DEMO_HOME}/projects/${name}\n`);
    for (const s of sessions) {
      const stamp = s.messages[0].timestamp.slice(0, 16).replace(/:/g, '-');
      writeFile(path.join(dir, 'chats', `session-${stamp}-${s.sessionId.slice(0, 8)}.json`), JSON.stringify(s));
    }
  }
  return counts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node scripts/marketing/demo-history.mjs <empty-data-dir>');
    process.exit(2);
  }
  const counts = writeDemoHistory(path.resolve(out));
  console.log(`Fictional history written to ${out}:`, counts);
}
