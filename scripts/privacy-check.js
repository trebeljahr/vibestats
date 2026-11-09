#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fixture = /^fixtures\/snapshot-(?:fixture|with-secret)\/snapshots\/2026-01-01\/projects\/-tmp-test-myproj\/session-day[12]\.jsonl$/;
const homePath = /\/(?:Users|home)\/(?!example(?:\/|$)|demo(?:\/|$)|yourname(?:\/|$)|you(?:\/|$)|username(?:\/|$)|anon(?:\/|$)|<)[A-Za-z0-9_.-]+\//;
const maxScanBytes = 2 * 1024 * 1024;
function forbidden(file) {
  if (fixture.test(file)) return false;
  return /(^|\/)(snapshots|data|private|exports|\.git\.bak[^/]*)(\/|$)/.test(file) ||
    /(^|\/)(pending-merges|pricing|pricing-cache|project-aliases|cwd-manifest[^/]*|\.claude-stats-config)\.json$/.test(file) ||
    /(^|\/)(?:redacted-.*|(?:codex-|combined-|claude-web-|gemini-|goose-|cline-)?dashboard)\.html$/.test(file) ||
    /\.(?:jsonl|sqlite(?:-[^/]*)?|db(?:-[^/]*)?|bundle|pem|key)$/.test(file) ||
    /(^|\/)\.env(?:$|\.(?!example$))/.test(file) || file === 'site/public/screenshot.png';
}
// History scan: a fixed number of git processes, not three per object. Each spawn costs
// ~0.5 s on macOS, so a per-object loop kept the pre-push hook busy for minutes and
// GitHub closed the idle SSH push connection.
function scanHistory(revision, bad) {
  const git = (args, opts) => execFileSync('git', args, {cwd:root, maxBuffer:256*1024*1024, ...opts});
  const named = [];
  for (const entry of git(['rev-list', '--objects', revision], {encoding:'utf8'}).trim().split('\n')) {
    const split = entry.indexOf(' ');
    if (split >= 0) named.push({oid: entry.slice(0,split), file: entry.slice(split+1)});
  }
  const info = git(['cat-file', '--buffer', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    {encoding:'utf8', input: named.map(o => o.oid + '\n').join('')}).split('\n').filter(Boolean);
  if (info.length !== named.length) throw new Error('git cat-file --batch-check returned an unexpected number of lines');
  // Findings are kept by rev-list position so the report order matches the old per-object loop.
  const found = [], blobs = [];
  named.forEach(({oid, file}, i) => {
    const [gotOid, type, size] = info[i].split(' ');
    if (gotOid !== oid || !size) throw new Error(`git cat-file could not read object ${oid}`);
    if (type !== 'blob') return;
    if (forbidden(file)) { found[i] = file + ' (history)'; return; }
    if (fixture.test(file)) return;
    if (Number(size) > maxScanBytes) return;
    blobs.push({i, oid, file, size: Number(size)});
  });
  // Read blob contents in chunks of up to 64 MiB to bound memory if history grows.
  for (let start = 0; start < blobs.length;) {
    let end = start, bytes = 0;
    while (end < blobs.length && (end === start || bytes + blobs[end].size <= 64*1024*1024)) bytes += blobs[end++].size;
    const chunk = blobs.slice(start, end);
    const out = git(['cat-file', '--buffer', '--batch'],
      {input: chunk.map(b => b.oid + '\n').join(''), maxBuffer: bytes + chunk.length * 128 + 1024});
    let pos = 0;
    for (const {i, oid, file, size} of chunk) {
      const eol = out.indexOf(10, pos);
      if (eol < 0 || out.toString('latin1', pos, eol) !== `${oid} blob ${size}`) throw new Error(`git cat-file --batch returned unexpected output for ${oid}`);
      const data = out.subarray(eol + 1, eol + 1 + size);
      pos = eol + 1 + size + 1;
      if (data.includes(0)) continue;
      // Metadata only: never include matching values in diagnostics.
      if (homePath.test(data.toString())) found[i] = file + ' (historical home path)';
    }
    start = end;
  }
  for (const finding of found) if (finding) bad.push(finding);
}
if (require.main === module) {
  let entries;
  try { entries = execFileSync('git', ['ls-files', '-z'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean); }
  catch { console.error('Privacy check needs a Git checkout.'); process.exit(1); }
  const bad = entries.filter(forbidden);
  for (const file of entries) {
    if (fixture.test(file)) continue;
    const stat = fs.statSync(path.join(root,file), {throwIfNoEntry:false});
    if (!stat || !stat.isFile() || stat.size > maxScanBytes) continue;
    const content = fs.readFileSync(path.join(root,file));
    if (content.includes(0)) continue;
    // Metadata only: never include matching values in diagnostics.
    if (homePath.test(content.toString())) bad.push(file);
  }
  if (process.argv.includes('--history')) {
    const idx = process.argv.indexOf('--history');
    const revision = process.argv[idx + 1] || 'HEAD';
    if (!/^(?:HEAD|[0-9a-f]{40,64})$/.test(revision)) throw new Error('Expected HEAD or a commit ID');
    scanHistory(revision, bad);
  }
  if (bad.length) {
    console.error('Private file/path candidates in tracked source:', [...new Set(bad)].join(', '));
    process.exit(1);
  }
  console.log(`Privacy guard: ${entries.length} tracked paths checked. This is not a complete secret audit.`);
}
module.exports = { forbidden };
