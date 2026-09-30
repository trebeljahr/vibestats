#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('./lib/paths');
const names = ['dashboard.html', ...['codex','combined','claude-web','gemini','goose','cline'].map(n => n + '-dashboard.html')];
const allowed = new Set([...names, ...names.map(n => 'redacted-' + n)]);
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
  console.error('Dashboard serving is local-only. Share a reviewed export through an authenticated host.');
  process.exit(1);
}
const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const root = fs.realpathSync(DATA_ROOT);
const server = http.createServer((req, res) => {
  const authority = req.headers.host || '';
  const validHosts = new Set(['127.0.0.1', 'localhost', '[::1]'].map(h => `${h}:${server.address().port}`));
  if (!validHosts.has(authority) || (req.headers.origin && req.headers.origin !== `http://${authority}`)) {
    res.writeHead(403); res.end(); return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const raw = req.url.split('?')[0];
  const name = raw === '/' ? 'combined-dashboard.html' : raw.slice(1);
  if (!allowed.has(name)) { res.writeHead(404); res.end(); return; }
  const file = path.join(root, name);
  // Reject links entirely; no raw snapshots, JSON config, or sibling files are served.
  try {
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw new Error('Not a regular dashboard');
    if (fs.realpathSync(file) !== file) throw new Error('Outside dashboard root');
    const data = fs.readFileSync(file);
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(port, host, () => console.log(`Dashboard: http://${host === '::1' ? '[::1]' : host}:${server.address().port}`));
