// Shared pricing loader. Returns a pricing.json-shaped object whose
// per-model rates may be overridden by a fresher LiteLLM cache, but whose
// subscription blocks (subscription, codex_subscription, fastModeMultiplier)
// always come from the user-owned pricing.json.
//
// Layering rules:
//   1. Start with pricing.json (user-owned source of truth)
//   2. If <DATA_ROOT>/pricing-cache.json exists AND is < 30 days old:
//        - merge cache.models on top of pricing.json.models (LiteLLM wins per-model)
//        - merge cache.openai_models on top of pricing.json.openai_models
//   3. Subscription blocks are NEVER overridden — pricing.json owns them.
//   4. If a model exists in pricing.json but not the cache, the pricing.json
//      entry is preserved (cache is additive / corrective, not exhaustive).
//
// Used by all 4 builders (build-dashboard, build-codex-dashboard,
// build-claude-web-dashboard, build-combined-dashboard) so the same merge
// logic applies everywhere.

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, PRICING_PATH } = require('./paths');

const PRICING_CACHE_PATH = path.join(DATA_ROOT, 'pricing-cache.json');
const STALE_AFTER_DAYS = 30;

function loadCache() {
  if (!fs.existsSync(PRICING_CACHE_PATH)) return null;
  let cache;
  try { cache = JSON.parse(fs.readFileSync(PRICING_CACHE_PATH, 'utf8')); }
  catch (e) {
    console.warn(`pricing-cache.json unparseable, ignoring: ${e.message}`);
    return null;
  }
  if (!cache.fetchedAt) return null;
  const ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > STALE_AFTER_DAYS) {
    // Stale — surface a hint but don't merge. User can re-run `vibestats prices update`.
    console.log(`pricing-cache.json is ${ageDays.toFixed(0)} days old (>${STALE_AFTER_DAYS}), ignoring. Re-run \`vibestats prices update\` to refresh.`);
    return null;
  }
  return cache;
}

function loadMergedPricing() {
  const base = JSON.parse(fs.readFileSync(PRICING_PATH, 'utf8'));
  const cache = loadCache();
  if (!cache) return base;

  // Merge per-model rates. Cache wins per-key; preserve pricing.json entries
  // the cache doesn't have. Strip comment keys from cache (defensive).
  const mergedClaude = { ...(base.models || {}) };
  for (const [k, v] of Object.entries(cache.models || {})) {
    if (k.startsWith('_')) continue;
    mergedClaude[k] = v;
  }
  const mergedOpenAI = { ...(base.openai_models || {}) };
  // Preserve the _comment in openai_models — it documents the field shape
  // and is referenced in docs.
  for (const [k, v] of Object.entries(cache.openai_models || {})) {
    if (k.startsWith('_')) continue;
    mergedOpenAI[k] = v;
  }

  return {
    ...base,
    models: mergedClaude,
    openai_models: mergedOpenAI,
    _pricingSource: {
      cacheUsed: true,
      cacheFetchedAt: cache.fetchedAt,
      cacheEntries: (Object.keys(cache.models || {}).filter(k => !k.startsWith('_')).length)
                  + (Object.keys(cache.openai_models || {}).filter(k => !k.startsWith('_')).length),
    },
  };
}

module.exports = {
  PRICING_CACHE_PATH,
  STALE_AFTER_DAYS,
  loadMergedPricing,
};

// Smoke test: `node scripts/lib/pricing.js` dumps the merged pricing summary.
if (require.main === module) {
  const merged = loadMergedPricing();
  const src = merged._pricingSource || { cacheUsed: false };
  console.log(`Merged pricing source:`);
  console.log(`  cache used:     ${src.cacheUsed}`);
  if (src.cacheUsed) {
    console.log(`  cache fetched:  ${src.cacheFetchedAt}`);
    console.log(`  cache entries:  ${src.cacheEntries}`);
  } else {
    console.log(`  (no cache, using pricing.json only — run \`vibestats prices update\` to fetch fresh prices)`);
  }
  console.log(`  Claude models:  ${Object.keys(merged.models || {}).filter(k => !k.startsWith('_') && k !== '<synthetic>').length}`);
  console.log(`  OpenAI models:  ${Object.keys(merged.openai_models || {}).filter(k => !k.startsWith('_')).length}`);
  console.log(`  Subscription:   ${merged.subscription && merged.subscription.tier} ($${merged.subscription && merged.subscription.monthly_usd}/mo)`);
  if (merged.codex_subscription) {
    console.log(`  Codex sub:      ${merged.codex_subscription.tier} ($${merged.codex_subscription.monthly_usd}/mo)`);
  }
}
