#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fixture = /^fixtures\/snapshot-(?:fixture|with-secret)\/snapshots\/2026-01-01\/projects\/-tmp-test-myproj\/session-day[12]\.jsonl$/;
function forbidden(file) {
  if (fixture.test(file)) return false;
  return /(^|\/)(snapshots|data|private|exports|\.git\.bak[^/]*)(\/|$)/.test(file) ||
    /(^|\/)(pending-merges|pricing|pricing-cache|project-aliases|cwd-manifest[^/]*|\.claude-stats-config)\.json$/.test(file) ||
    /(^|\/)(?:redacted-.*|(?:codex-|combined-|claude-web-|gemini-|goose-|cline-)?dashboard)\.html$/.test(file) ||
    /\.(?:jsonl|sqlite(?:-[^/]*)?|db(?:-[^/]*)?|bundle|pem|key)$/.test(file) ||
    /(^|\/)\.env(?:$|\.(?!example$))/.test(file) || file === 'site/public/screenshot.png';
}
if (require.main === module) {
  let entries;
  try { entries = execFileSync('git', ['ls-files', '-z'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean); }
  catch { console.error('Privacy check needs a Git checkout.'); process.exit(1); }
  const bad = entries.filter(forbidden);
  for (const file of entries) {
    if (fixture.test(file)) continue;
    const stat = fs.statSync(path.join(root,file), {throwIfNoEntry:false});
    if (!stat || !stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const content = fs.readFileSync(path.join(root,file));
    if (content.includes(0)) continue;
    // Metadata only: never include matching values in diagnostics.
    if (/\/(?:Users|home)\/(?!example(?:\/|$)|demo(?:\/|$)|yourname(?:\/|$)|you(?:\/|$)|username(?:\/|$)|anon(?:\/|$)|<)[A-Za-z0-9_.-]+\//.test(content.toString())) bad.push(file);
  }
  if (process.argv.includes('--history')) {
    const idx = process.argv.indexOf('--history');
    const revision = process.argv[idx + 1] || 'HEAD';
    if (!/^(?:HEAD|[0-9a-f]{40,64})$/.test(revision)) throw new Error('Expected HEAD or a commit ID');
    const objects = execFileSync('git', ['rev-list', '--objects', revision], {cwd:root,encoding:'utf8'}).trim().split('\n');
    for (const entry of objects) {
      const split = entry.indexOf(' ');
      if (split < 0) continue;
      const oid = entry.slice(0,split), file = entry.slice(split+1);
      if (forbidden(file)) { bad.push(file + ' (history)'); continue; }
      if (fixture.test(file)) continue;
      if (execFileSync('git',['cat-file','-t',oid],{cwd:root,encoding:'utf8'}).trim() !== 'blob') continue;
      const size = Number(execFileSync('git',['cat-file','-s',oid],{cwd:root,encoding:'utf8'}));
      if (size > 2 * 1024 * 1024) continue;
      const data = execFileSync('git',['cat-file','blob',oid],{cwd:root,maxBuffer:3*1024*1024});
      if (data.includes(0)) continue;
      if (/\/(?:Users|home)\/(?!example(?:\/|$)|demo(?:\/|$)|yourname(?:\/|$)|you(?:\/|$)|username(?:\/|$)|anon(?:\/|$)|<)[A-Za-z0-9_.-]+\//.test(data.toString())) bad.push(file + ' (historical home path)');
    }
  }
  if (bad.length) {
    console.error('Private file/path candidates in tracked source:', [...new Set(bad)].join(', '));
    process.exit(1);
  }
  console.log(`Privacy guard: ${entries.length} tracked paths checked. This is not a complete secret audit.`);
}
module.exports = { forbidden };
