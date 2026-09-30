#!/usr/bin/env node
/*
 * redact — produce sharing-safe versions of the built dashboards by
 * replacing project names with stable hashes. Optionally bucket the
 * heatmap to coarser dates so per-day activity patterns don't leak
 * sleep schedule / vacation timing.
 *
 * Usage:
 *   node scripts/redact.js                       # write redacted-*.html dashboards AND redacted-cwd-manifest.json per snapshot
 *   node scripts/redact.js --check               # scan latest snapshot for secret patterns, exit non-zero if any found
 *   node scripts/redact.js --coarsen-dates=week  # also bucket heatmap days into ISO weeks
 *   node scripts/redact.js --coarsen-dates=month # bucket into month starts
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderTemplate } = require('./lib/render-template');
const salt = crypto.randomBytes(32).toString('hex');
const { DATA_ROOT, SNAP_ROOT } = require('./lib/paths');

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const coarsenArg = args.find(a => a.startsWith('--coarsen-dates='));
const coarsen = coarsenArg ? coarsenArg.split('=')[1] : null;
if (coarsen && coarsen !== 'week' && coarsen !== 'month') {
  console.error(`--coarsen-dates must be 'week' or 'month', got '${coarsen}'`);
  process.exit(2);
}

if (isCheck) {
  runSecretCheck();
  return;
}

runRedact();

// ---- redaction ----

function hashName(s) {
  return 'project-' + crypto.createHash('sha256').update(salt + String(s)).digest('hex').slice(0, 8);
}

function hashPath(s) {
  return 'path-' + crypto.createHash('sha256').update(salt + String(s)).digest('hex').slice(0, 8);
}

function hashRemote(s) {
  return 'remote-' + crypto.createHash('sha256').update(salt + String(s)).digest('hex').slice(0, 8);
}

function bucketDay(day) {
  if (!coarsen) return day;
  const d = new Date(day + 'T00:00:00Z');
  if (coarsen === 'month') {
    return d.toISOString().slice(0, 7) + '-01';
  }
  // ISO week: snap to Monday
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function redactPayload(data) {
  // Map original name → hash
  const nameMap = new Map();
  const project = name => {
    if (!nameMap.has(name)) nameMap.set(name, hashName(name));
    return nameMap.get(name);
  };

  // Redact projects
  for (const p of data.projects || []) {
    p.name = project(p.name);
    if (p.mergedFrom) p.mergedFrom = p.mergedFrom.map(project);
  }

  for (const d of data.heatmap || []) {
    for (const p of d.byProject || []) p.name = project(p.name);
  }
  if (coarsen) {
    for (const p of data.projects || []) {
      if (p.days) p.days = [...new Set(p.days.map(bucketDay))];
    }
    if (data.summary) {
      if (data.summary.snapshot) data.summary.snapshot = bucketDay(data.summary.snapshot.slice(0, 10));
      delete data.summary.generatedAt;
    }
  }

  // Heatmap day bucketing — collapse multiple days into the same bucket
  if (coarsen && data.heatmap) {
    const buckets = new Map();
    for (const d of data.heatmap) {
      const k = bucketDay(d.day);
      let acc = buckets.get(k);
      if (!acc) { acc = { day: k, sessions: 0, messages: 0, byModel: [] }; buckets.set(k, acc); }
      acc.sessions += d.sessions;
      acc.messages += d.messages;
      for (const u of d.byModel) acc.byModel.push(u); // keep duplicates; downstream sums them per model
    }
    // Merge byModel within each bucket
    for (const acc of buckets.values()) {
      const byKey = new Map();
      for (const u of acc.byModel) {
        const key = (u.tool || '?') + ':' + u.model;
        let agg = byKey.get(key);
        if (!agg) { agg = { ...u, messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0 }; byKey.set(key, agg); }
        agg.messages += u.messages || 0;
        agg.input += u.input || 0;
        agg.output += u.output || 0;
        agg.cacheRead += u.cacheRead || 0;
        agg.cacheCreate5m += u.cacheCreate5m || 0;
        agg.cacheCreate1h += u.cacheCreate1h || 0;
      }
      acc.byModel = [...byKey.values()];
    }
    data.heatmap = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
    if (data.summary) {
      if (data.summary.firstDay) data.summary.firstDay = bucketDay(data.summary.firstDay);
      if (data.summary.lastDay) data.summary.lastDay = bucketDay(data.summary.lastDay);
    }
  }

  // Strip homePrefix so the displayed username leaks nothing
  if (data.summary) data.summary.homePrefix = '-home-anon';

  return data;
}

function runRedact() {
  const inputs = ['dashboard.html', ...['codex','combined','claude-web','gemini','goose','cline'].map(n => n + '-dashboard.html')];
  const outputs = [];
  for (const name of inputs) {
    const src = path.join(DATA_ROOT, name);
    if (!fs.existsSync(src)) continue;
    const html = fs.readFileSync(src, 'utf8');
    const current = html.match(/<script>window\.__VIBESTATS_DATA = ([\s\S]+?);<\/script>/);
    const legacy = html.match(/const DATA = (\{[\s\S]+?\});\s*const PRICING/);
    const match = current || legacy;
    if (!match) throw new Error(`Cannot redact ${name}: unsupported or empty dashboard. No outputs updated; existing redacted files may be stale.`);
    const data = JSON.parse(match[1]);
    if (!Array.isArray(data.projects) || !Array.isArray(data.heatmap)) throw new Error(`Unsupported payload in ${name}`);
    outputs.push([path.join(DATA_ROOT, 'redacted-' + name), renderTemplate(redactPayload(data))]);
  }
  if (!outputs.length) throw new Error('No dashboards found. Existing redacted files may be stale.');
  for (const [target, html] of outputs) {
    fs.writeFileSync(target, html, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
  }
  redactSnapshotManifests();
  console.log(`Updated ${outputs.length} redacted dashboards. Review before sharing: usage counts, costs, model names and activity remain. Share only these files, never the data directory.`);
}

// Rewrite cwd-manifest.json files in every snapshot to a redacted sibling
// (`redacted-cwd-manifest.json`). The original is left in place because
// dashboard rebuilds still need the real cwds / remotes for grouping.
// Hashing is deterministic so two projects sharing a remote still appear
// linked in the redacted output, but the URL string itself is gone.
function redactSnapshotManifests() {
  if (!fs.existsSync(SNAP_ROOT)) return 0;
  const snapDirs = fs.readdirSync(SNAP_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  let count = 0;
  for (const snapName of snapDirs) {
    const manifestPath = path.join(SNAP_ROOT, snapName, 'cwd-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { console.warn(`  ${snapName}/cwd-manifest.json: ${e.message}`); continue; }
    const redacted = {};
    for (const [key, info] of Object.entries(manifest)) {
      const newKey = hashName(key);
      redacted[newKey] = {
        cwd: info.cwd ? hashPath(info.cwd) : null,
        remote: info.remote ? hashRemote(info.remote) : null,
        repoRoot: info.repoRoot ? hashPath(info.repoRoot) : null,
      };
    }
    const outPath = path.join(SNAP_ROOT, snapName, 'redacted-cwd-manifest.json');
    fs.writeFileSync(outPath, JSON.stringify(redacted, null, 2), { mode: 0o600 });
    console.log(`  wrote ${outPath}`);
    count++;
  }
  return count;
}

// ---- secret check ----

function runSecretCheck() {
  const snapDirs = fs.existsSync(SNAP_ROOT)
    ? fs.readdirSync(SNAP_ROOT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    : [];
  if (!snapDirs.length) {
    console.log('No snapshots to scan.');
    return;
  }
  const SNAP = path.join(SNAP_ROOT, snapDirs[snapDirs.length - 1]);
  console.log(`Scanning ${SNAP} for secrets...`);

  // Pattern docs (no tests/ dir; rationale inline so the regex isn't cargo-culted):
  //   GitHub PAT classic:    `ghp_` + 36 base62. GitHub's documented format.
  //   GitHub fine-grained:   `github_pat_` + 82 chars w/ underscores.
  //   GitHub OAuth:          `gho_` + 36 base62.
  //   GitLab PAT:            `glpat-` + ≥20 hyphenated word chars.
  //   Anthropic API:         `sk-ant-` + ≥30 url-safe chars (catches sk-ant-api03-… too).
  //   Anthropic admin key:   `sk-ant-api03-` + ≥40 chars; labelled separately so admin-key
  //                          leaks (org-level, blast radius bigger) are visible in the report.
  //   OpenAI:                `sk-` or `sk-proj-` + ≥32 url-safe chars.
  //   Google API:            `AIza` + 35 url-safe chars (documented).
  //   AWS access key:        `AKIA` + 16 uppercase alphanumeric (documented).
  //   Slack token:           `xoxa/b/p/r/s-` followed by ≥10 hyphenated chars.
  //   Stripe live key:       `sk_live_` + ≥24 base62.
  //   Vercel token:          `vercel_` prefix forms (blob_rw, edge_config, etc.). Catches
  //                          most Vercel-issued tokens; bare 24-char personal tokens have
  //                          no fixed prefix and would false-positive too often, so omitted.
  //   Netlify token:         `nfp_` + ≥32 base62 (Netlify personal access tokens).
  //   Discord bot:           three dot-separated segments (24 . 6 . 27 base62-ish).
  //   Cloudflare API token:  matched only when assigned to `CF_API_TOKEN=` to avoid hitting
  //                          random 40-char hex strings elsewhere in a transcript.
  //   JWT:                   three base64url segments separated by dots, header starts `eyJ`.
  //   SSH private key:       header line of any PEM-encoded private key dump.
  //   Bearer auth header:    `Authorization: Bearer …` captured from HTTP request logs.
  //   Git SSH remote URL:    `git@host:org/repo.git` — leaks private-repo names + org.
  //   macOS home path:       `/Users/<name>/` — leaks the local OS username.
  //   Linux home path:       `/home/<name>/` — same on Linux hosts.
  const PATTERNS = {
    'GitHub PAT (classic)':  /ghp_[A-Za-z0-9]{36}/g,
    'GitHub fine-grained':   /github_pat_[A-Za-z0-9_]{82}/g,
    'GitHub OAuth':          /gho_[A-Za-z0-9]{36}/g,
    'GitLab PAT':            /glpat-[\w-]{20,}/g,
    'Anthropic API key':     /sk-ant-[A-Za-z0-9_-]{30,}/g,
    'Anthropic admin key':   /sk-ant-api03-[\w-]{40,}/g,
    'OpenAI API key':        /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
    'Google API key':        /AIza[0-9A-Za-z_-]{35}/g,
    'AWS access key':        /AKIA[0-9A-Z]{16}/g,
    'Slack token':           /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    'Stripe live key':       /sk_live_[A-Za-z0-9]{24,}/g,
    'Vercel token':          /vercel_[A-Za-z0-9_]{24,}/g,
    'Netlify token':         /nfp_[A-Za-z0-9]{32,}/g,
    'Discord bot token':     /[A-Za-z\d]{24}\.[\w-]{6}\.[\w-]{27}/g,
    'Cloudflare API token':  /CF_API_TOKEN=[A-Za-z0-9_-]{40}/g,
    'JWT':                   /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    'SSH private key':       /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/g,
    'Bearer auth header':    /Authorization:\s*Bearer\s+[\w.-]+/g,
    'Git SSH remote URL':    /git@[\w.-]+:[\w./-]+\.git/g,
    'macOS home path':       /\/Users\/[\w.-]+\//g,
    'Linux home path':       /\/home\/[\w.-]+\//g,
  };

  const counts = {};
  const samples = {};
  for (const k of Object.keys(PATTERNS)) { counts[k] = 0; samples[k] = []; }

  let totalFiles = 0;
  walk(SNAP, f => {
    totalFiles++;
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const [label, re] of Object.entries(PATTERNS)) {
      const matches = content.match(re);
      if (matches) {
        counts[label] += matches.length;
        if (samples[label].length < 2) samples[label].push({ file: path.relative(SNAP, f), match: '[value withheld]' });
      }
    }
  });

  let total = 0;
  console.log(`\nScanned ${totalFiles} files. Findings:`);
  for (const [label, n] of Object.entries(counts)) {
    if (!n) continue;
    total += n;
    console.log(`  ${label.padEnd(28)} ${n}`);
    for (const s of samples[label]) console.log(`    ${s.match}  ${s.file}`);
  }
  if (!total) {
    console.log('  (no matches)');
  } else {
    console.log(`\n${total} total. Do NOT share unredacted snapshots or dashboards built from them.`);
    process.exit(2);
  }
}

function walk(dir, fn) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else if (e.isFile()) fn(p);
  }
}
