#!/usr/bin/env node
// Fetch LiteLLM's daily-updated model pricing JSON and cache it locally.
//
// Source: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
// Schema (per model):
//   {
//     "litellm_provider": "anthropic" | "openai" | "bedrock" | ...,
//     "input_cost_per_token":  1.25e-06,      // $ per token
//     "output_cost_per_token": 1e-05,
//     "cache_read_input_token_cost":      1.25e-07,
//     "cache_creation_input_token_cost":  6.25e-06,  // 5-min ephemeral cache write
//     "cache_creation_input_token_cost_above_1hr": 1e-05,  // 1-hour cache write
//     ...
//   }
//
// We multiply by 1e6 to get the $/MTok format pricing.json uses, and write
// only the Claude/OpenAI families vibestats actually meters. The cache is
// merged on top of pricing.json by scripts/lib/pricing.js — subscription
// blocks always stay user-owned.
//
// Opt-in only — never auto-fetched. Run: `vibestats prices update`.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, ensureDataRoot } = require('./lib/paths');
const { PRICING_CACHE_PATH } = require('./lib/pricing');

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const MIN_ENTRIES = 100; // safety: refuse to write if the response looks truncated

ensureDataRoot();

async function main() {
  console.log(`Fetching ${LITELLM_URL}`);
  let raw;
  try {
    const res = await fetch(LITELLM_URL);
    if (!res.ok) {
      console.error(`HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    raw = await res.json();
  } catch (e) {
    console.error(`Fetch failed: ${e.message}`);
    process.exit(1);
  }

  const totalEntries = Object.keys(raw).length;
  if (totalEntries < MIN_ENTRIES) {
    console.error(`LiteLLM response only had ${totalEntries} entries (expected ≥ ${MIN_ENTRIES}). Refusing to overwrite cache — response looks truncated.`);
    process.exit(2);
  }
  console.log(`LiteLLM response: ${totalEntries} model entries`);

  const claudeModels = {};
  const openaiModels = {};
  let skippedNonChat = 0, skippedOtherProvider = 0, skippedNoPricing = 0;

  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    // Stick to chat models (skip embeddings, audio, image, moderation, etc.)
    if (entry.mode && entry.mode !== 'chat') { skippedNonChat++; continue; }

    const provider = entry.litellm_provider;
    if (provider === 'anthropic' && name.startsWith('claude-')) {
      const mapped = mapAnthropic(entry);
      if (!mapped) { skippedNoPricing++; continue; }
      claudeModels[name] = mapped;
    } else if (provider === 'openai' && (name.startsWith('gpt-') || name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4'))) {
      const mapped = mapOpenAI(entry);
      if (!mapped) { skippedNoPricing++; continue; }
      openaiModels[name] = mapped;
    } else {
      skippedOtherProvider++;
    }
  }

  const claudeCount = Object.keys(claudeModels).length;
  const openaiCount = Object.keys(openaiModels).length;
  console.log(`  ${claudeCount} Claude (anthropic provider, claude-*) models`);
  console.log(`  ${openaiCount} OpenAI (openai provider, gpt-/o*) models`);
  console.log(`  skipped: ${skippedNonChat} non-chat, ${skippedOtherProvider} non-Claude/OpenAI providers, ${skippedNoPricing} missing price fields`);

  if (claudeCount === 0 && openaiCount === 0) {
    console.error('No Claude or OpenAI models matched — refusing to write empty cache.');
    process.exit(2);
  }

  const cache = {
    _comment: 'Auto-fetched from LiteLLM. Per-MTok USD. Merged on top of pricing.json by scripts/lib/pricing.js; subscription blocks stay user-owned. Re-fetch: vibestats prices update.',
    source: LITELLM_URL,
    fetchedAt: new Date().toISOString(),
    totalEntriesScanned: totalEntries,
    models: claudeModels,
    openai_models: openaiModels,
  };

  fs.writeFileSync(PRICING_CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(PRICING_CACHE_PATH, 0o600); } catch {}
  console.log(`Wrote ${PRICING_CACHE_PATH} (${claudeCount + openaiCount} models, 0600 perms)`);
}

// Anthropic: input / output + cache_5m / cache_1h / cache_read.
// LiteLLM's `cache_creation_input_token_cost` is the 5-min ephemeral write
// price; `cache_creation_input_token_cost_above_1hr` is the 1-hour variant.
function mapAnthropic(e) {
  if (e.input_cost_per_token == null || e.output_cost_per_token == null) return null;
  return {
    input:      tok(e.input_cost_per_token),
    cache_5m:   tok(e.cache_creation_input_token_cost  ?? e.input_cost_per_token * 1.25),
    cache_1h:   tok(e.cache_creation_input_token_cost_above_1hr ?? e.input_cost_per_token * 2),
    cache_read: tok(e.cache_read_input_token_cost      ?? e.input_cost_per_token * 0.1),
    output:     tok(e.output_cost_per_token),
  };
}

// OpenAI: input / output + cache_read (cached_input). Codex/GPT don't expose
// 5m vs 1h cache TTLs in the rollout schema, so cache_5m/cache_1h are 0 — the
// builder already treats them as 0 today.
function mapOpenAI(e) {
  if (e.input_cost_per_token == null || e.output_cost_per_token == null) return null;
  return {
    input:      tok(e.input_cost_per_token),
    cache_read: tok(e.cache_read_input_token_cost ?? e.input_cost_per_token * 0.1),
    cache_5m:   0,
    cache_1h:   0,
    output:     tok(e.output_cost_per_token),
  };
}

// per-token → per-MTok, rounded to 4 decimals (avoids 0.30000000000000004 noise)
function tok(n) {
  if (n == null) return 0;
  return Math.round(n * 1e6 * 10000) / 10000;
}

main().catch(e => {
  console.error(`prices-update failed: ${e.message}`);
  process.exit(1);
});
