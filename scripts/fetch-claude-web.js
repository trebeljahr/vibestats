#!/usr/bin/env node
// Fetch claude.ai web chat history via the unofficial REST API.
// Captures conversation list + per-conversation messages into snapshots/<date>/claude-web/.
//
// AUTH: extract sessionKey cookie from claude.ai in a browser DevTools session:
//   1. Open claude.ai logged in
//   2. DevTools → Application → Cookies → https://claude.ai
//   3. Copy the `sessionKey` value (starts with `sk-ant-sid01-...`)
//   4. Provide it to this script either via:
//        export CLAUDE_SESSION_KEY=sk-ant-sid01-...
//        node scripts/fetch-claude-web.js
//      or by writing { "session_key": "sk-ant-sid01-..." } to:
//        ~/.claude-stats-config.json   (chmod 600)
//
// The script paginates, is resumable (skips already-downloaded chat UUIDs), and
// writes one JSON file per conversation so partial runs aren't lost.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SNAP_ROOT, ensureDataRoot } = require('./lib/paths');

ensureDataRoot();

function loadSessionKey() {
  if (process.env.CLAUDE_SESSION_KEY) return process.env.CLAUDE_SESSION_KEY;
  const cfg = path.join(os.homedir(), '.claude-stats-config.json');
  if (fs.existsSync(cfg)) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (j.session_key) return j.session_key;
    } catch (e) { console.error('Failed to parse', cfg, e.message); }
  }
  return null;
}

const sessionKey = loadSessionKey();
if (!sessionKey) {
  console.error('Missing sessionKey. Set CLAUDE_SESSION_KEY env var or write ~/.claude-stats-config.json.');
  console.error('See header of this script for instructions.');
  process.exit(1);
}

const HEADERS = {
  'Cookie': `sessionKey=${sessionKey}`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} on ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const OUT = path.join(SNAP_ROOT, today, 'claude-web');
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`Fetching orgs...`);
  const orgs = await get('https://claude.ai/api/organizations');
  if (!Array.isArray(orgs) || !orgs.length) {
    console.error('No organizations returned. sessionKey may be stale.');
    process.exit(1);
  }
  console.log(`Found ${orgs.length} org(s):`);
  for (const o of orgs) console.log(`  ${o.uuid}  ${o.name}`);

  // Save org list
  fs.writeFileSync(path.join(OUT, '_orgs.json'), JSON.stringify(orgs, null, 2));

  for (const org of orgs) {
    console.log(`\n=== Org ${org.name} (${org.uuid}) ===`);
    const orgDir = path.join(OUT, org.uuid);
    fs.mkdirSync(orgDir, { recursive: true });

    let allConvos = [];
    let url = `https://claude.ai/api/organizations/${org.uuid}/chat_conversations`;
    // Some Anthropic deployments paginate via offset/limit; others return all at once.
    // Try the simple form first.
    try {
      const list = await get(url);
      allConvos = Array.isArray(list) ? list : (list.conversations || []);
    } catch (e) {
      console.error(`List fetch failed: ${e.message}`);
      continue;
    }
    console.log(`  ${allConvos.length} conversations`);
    fs.writeFileSync(path.join(orgDir, '_conversations.json'), JSON.stringify(allConvos, null, 2));

    let downloaded = 0, skipped = 0, failed = 0;
    for (const c of allConvos) {
      const uuid = c.uuid;
      const out = path.join(orgDir, `${uuid}.json`);
      if (fs.existsSync(out)) { skipped++; continue; }
      try {
        const detail = await get(`https://claude.ai/api/organizations/${org.uuid}/chat_conversations/${uuid}?tree=True&rendering_mode=raw`);
        fs.writeFileSync(out, JSON.stringify(detail), { mode: 0o600 });
        downloaded++;
        if (downloaded % 25 === 0) console.log(`  ${downloaded}/${allConvos.length} downloaded`);
        await new Promise(r => setTimeout(r, 150)); // gentle pace
      } catch (e) {
        failed++;
        console.error(`  ${uuid}: ${e.message}`);
      }
    }
    console.log(`  Done: ${downloaded} new, ${skipped} cached, ${failed} failed`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
