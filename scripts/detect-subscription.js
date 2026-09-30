#!/usr/bin/env node
// Infer the user's Claude / Codex subscription from observed token volume
// in the latest snapshot. Writes back to pricing.json IF the file doesn't
// exist yet OR has _autoDetected:true (never clobbers user edits).
//
// Heuristic buckets (sustained monthly tokens across active months):
//
//   Anthropic
//     < 5M  + no Opus      → API ($0/mo; user pays per token)
//     5–80M + Sonnet-heavy → Pro ($17/mo)
//     80–400M + ≥20% Opus  → Max 5x ($100/mo)
//     > 400M sustained Opus → Max 20x ($200/mo)
//
//   Codex
//     no data              → skip block
//     any                  → ChatGPT Plus ($20/mo)
//     > 100M sustained gpt-5-codex → ChatGPT Pro ($200/mo)
//
// started date = oldest jsonl timestamp snapped to first of that month.

const fs = require('fs');
const path = require('path');
const { PRICING_PATH, EXAMPLE_PRICING, ensureDataRoot } = require('./lib/paths');
const { resolveSources } = require('./lib/sources');

ensureDataRoot();

// Walk fs collecting jsonl
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

const src = resolveSources();
if (!src.live && !src.snapshotName) {
  console.log('detect-subscription: no snapshot yet, skipping.');
  process.exit(0);
}

// Per-tool tally: { model -> totalTokens }, plus per-month tally for "sustained"
const claude = { byModel: new Map(), byMonth: new Map(), oldestTs: null };
const codex = { byModel: new Map(), byMonth: new Map(), oldestTs: null };

function bump(tally, model, tokens, ts) {
  tally.byModel.set(model, (tally.byModel.get(model) || 0) + tokens);
  if (ts) {
    const month = ts.slice(0, 7);
    let m = tally.byMonth.get(month);
    if (!m) { m = new Map(); tally.byMonth.set(month, m); }
    m.set(model, (m.get(model) || 0) + tokens);
    if (!tally.oldestTs || ts < tally.oldestTs) tally.oldestTs = ts;
  }
}

// ---- Claude ----
for (const sub of ['projects', 'projects-archive']) {
  const root = src.dir(sub);
  if (!root) continue;
  for (const f of walk(root)) {
    let content; try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const m = obj.message;
      if (!m || !m.usage || !m.model) continue;
      const u = m.usage;
      const tokens = (u.input_tokens || 0) + (u.output_tokens || 0)
        + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (!tokens) continue;
      bump(claude, m.model, tokens, obj.timestamp);
    }
  }
}

// ---- Codex ----
const codexRoot = src.dir('codex-sessions');
if (codexRoot) {
  for (const f of walk(codexRoot)) {
    let content; try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    let currentModel = null;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const p = obj.payload || {};
      if (obj.type === 'turn_context' && p.model) currentModel = p.model;
      if (obj.type === 'event_msg' && p.type === 'token_count' && p.info && p.info.last_token_usage) {
        const u = p.info.last_token_usage;
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0)
          + (u.reasoning_output_tokens || 0);
        if (tokens && currentModel) bump(codex, currentModel, tokens, obj.timestamp);
      }
    }
  }
}

function totalTokens(tally) {
  let n = 0; for (const v of tally.byModel.values()) n += v; return n;
}
function monthCount(tally) { return tally.byMonth.size; }
function avgMonthly(tally) {
  const months = monthCount(tally);
  return months ? totalTokens(tally) / months : 0;
}
function tokensForModelPrefix(tally, prefix) {
  let n = 0;
  for (const [m, v] of tally.byModel) if (m.startsWith(prefix)) n += v;
  return n;
}
function snapToMonthStart(ts) {
  if (!ts) return null;
  return ts.slice(0, 7) + '-01';
}

function detectClaude() {
  const total = totalTokens(claude);
  if (total === 0) return null;
  const monthly = avgMonthly(claude);
  const opus = tokensForModelPrefix(claude, 'claude-opus-');
  const sonnet = tokensForModelPrefix(claude, 'claude-sonnet-');
  const opusShare = total > 0 ? opus / total : 0;

  let tier, monthly_usd;
  if (monthly < 5e6 && opus === 0) {
    tier = 'API'; monthly_usd = 0;
  } else if (monthly < 80e6 && opusShare < 0.2) {
    tier = 'Pro'; monthly_usd = 17;
  } else if (monthly < 400e6) {
    tier = 'Max 5x'; monthly_usd = 100;
  } else {
    tier = 'Max 20x'; monthly_usd = 200;
  }
  return {
    tier, monthly_usd,
    started: snapToMonthStart(claude.oldestTs),
    _signals: {
      avgMonthlyTokens: Math.round(monthly),
      opusShare: Number(opusShare.toFixed(3)),
      activeMonths: monthCount(claude),
    },
  };
}

function detectCodex() {
  const total = totalTokens(codex);
  if (total === 0) return null;
  const codexHeavy = tokensForModelPrefix(codex, 'gpt-5-codex');
  const monthly = avgMonthly(codex);
  let tier, monthly_usd;
  if (codexHeavy > 100e6 * monthCount(codex)) { tier = 'ChatGPT Pro'; monthly_usd = 200; }
  else { tier = 'ChatGPT Plus'; monthly_usd = 20; }
  return {
    tier, monthly_usd,
    started: snapToMonthStart(codex.oldestTs),
    _signals: {
      avgMonthlyTokens: Math.round(monthly),
      codexShare: total ? Number((codexHeavy / total).toFixed(3)) : 0,
      activeMonths: monthCount(codex),
    },
  };
}

// Decide whether we may overwrite pricing.json. Rule: write if file missing,
// or if the existing file's subscription block has _autoDetected: true.
// Once a user has edited (or confirmed via the dashboard banner), they own it.
function loadExistingPricing() {
  if (fs.existsSync(PRICING_PATH)) {
    try { return JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8')); }
    catch (e) { console.warn('detect-subscription: existing pricing.json unparseable, using example as base.', e.message); }
  }
  if (fs.existsSync(EXAMPLE_PRICING)) {
    return JSON.parse(fs.readFileSync(EXAMPLE_PRICING, 'utf8'));
  }
  return { models: {}, openai_models: {} };
}

const existing = loadExistingPricing();
const subAuto = existing.subscription && existing.subscription._autoDetected;
const codexAuto = existing.codex_subscription && existing.codex_subscription._autoDetected;
const isFirstRun = !fs.existsSync(PRICING_PATH);

if (!isFirstRun && existing.subscription && !subAuto) {
  console.log('detect-subscription: pricing.json has a user-edited subscription block (_autoDetected not true). Leaving as-is.');
  process.exit(0);
}

const detectedClaude = detectClaude();
const detectedCodex = detectCodex();

if (!detectedClaude && !detectedCodex) {
  console.log('detect-subscription: no token usage observed, skipping.');
  process.exit(0);
}

if (detectedClaude) {
  existing.subscription = {
    _autoDetected: true,
    detectedAt: new Date().toISOString().slice(0, 10),
    ...detectedClaude,
  };
  console.log(`  Claude: ${detectedClaude.tier} ($${detectedClaude.monthly_usd}/mo, started ${detectedClaude.started})`);
  console.log(`    signals: ${JSON.stringify(detectedClaude._signals)}`);
}
if (detectedCodex && (codexAuto || isFirstRun || !existing.codex_subscription)) {
  existing.codex_subscription = {
    _autoDetected: true,
    detectedAt: new Date().toISOString().slice(0, 10),
    ...detectedCodex,
  };
  console.log(`  Codex:  ${detectedCodex.tier} ($${detectedCodex.monthly_usd}/mo, started ${detectedCodex.started})`);
  console.log(`    signals: ${JSON.stringify(detectedCodex._signals)}`);
}

fs.writeFileSync(PRICING_PATH, JSON.stringify(existing, null, 2) + '\n');
console.log(`Wrote ${PRICING_PATH}`);
