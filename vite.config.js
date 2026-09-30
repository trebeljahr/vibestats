import { defineConfig } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Inline the production dashboard template's <head> contents + <body> markup
// into the dev preview index.html so the dev page never drifts from prod.
// The template's two inline <script> blocks are stripped — preview.js wires
// the payload + dashboard module instead.
function inlineDashboardTemplate() {
  return {
    name: 'inline-dashboard-template',
    transformIndexHtml(html) {
      const tplPath = path.resolve(__dirname, 'scripts/dashboard-template.html');
      const tpl = fs.readFileSync(tplPath, 'utf8');
      const headMatch = tpl.match(/<head>([\s\S]*?)<\/head>/);
      const bodyMatch = tpl.match(/<body>([\s\S]*?)<\/body>/);
      if (!headMatch || !bodyMatch) throw new Error('dashboard-template.html: cannot find <head> or <body>');
      // Drop the prod <title> — the dev index.html supplies its own.
      const headInner = headMatch[1].replace(/<title>[\s\S]*?<\/title>/, '');
      const bodyInner = bodyMatch[1]
        .replace(/<script>window\.__VIBESTATS_DATA[\s\S]*?<\/script>/, '')
        .replace(/<script>\s*\/\*\s*__SCRIPT__\s*\*\/\s*<\/script>/, '');
      return html
        .replace('<!-- DASHBOARD_HEAD -->', headInner)
        .replace('<!-- DASHBOARD_BODY -->', bodyInner);
    },
    // Pick up template.html edits without restarting vite.
    configureServer(server) {
      const tplPath = path.resolve(__dirname, 'scripts/dashboard-template.html');
      server.watcher.add(tplPath);
      server.watcher.on('change', file => {
        if (file === tplPath) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

// Serve the dev preview real data.
//
// The preview used to import dev/dashboard-preview/sample-payload.json, a
// checked-in anonymised fixture. That silently froze `pnpm dev` at whatever day
// the fixture was generated, which reads as "the dashboard stopped updating".
// Now the dev server runs the live build (VIBESTATS_LIVE=1 — reads ~/.claude,
// ~/.codex, ~/.gemini in place, no snapshot rsync) and serves the merged
// payload at /payload.json. The fixture stays as the fallback for anyone with
// no local AI-tool history, and via VIBESTATS_FIXTURE=1 for reproducible
// screenshots.
function livePayload() {
  const CODE_ROOT = __dirname;
  const FIXTURE = path.resolve(CODE_ROOT, 'dev/dashboard-preview/sample-payload.json');
  const useFixture = /^(1|true|yes|on)$/i.test(process.env.VIBESTATS_FIXTURE || '');

  // Mirrors scripts/lib/paths.js.
  function dataRoot() {
    if (process.env.VIBESTATS_DATA_DIR) return path.resolve(process.env.VIBESTATS_DATA_DIR);
    if (fs.existsSync(path.join(CODE_ROOT, 'pricing.json'))) return CODE_ROOT;
    return path.join(os.homedir(), '.vibestats');
  }
  const aggPath = () => path.join(dataRoot(), 'data', 'combined-agg.json');

  let pending = null;

  function runLiveBuild(log) {
    if (pending) return pending;
    const started = Date.now();
    log('building dashboard payload from live ~/.claude + ~/.codex + ~/.gemini …');
    pending = new Promise(resolve => {
      const child = spawn('bash', [path.join(CODE_ROOT, 'scripts/build-all.sh')], {
        env: { ...process.env, VIBESTATS_LIVE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stdout.on('data', () => {});
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', code => {
        pending = null;
        if (code === 0) log(`payload ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        else log(`live build failed (exit ${code}) — falling back to fixture\n${stderr.trim()}`);
        resolve(code === 0);
      });
      child.on('error', e => {
        pending = null;
        log(`live build could not start (${e.message}) — falling back to fixture`);
        resolve(false);
      });
    });
    return pending;
  }

  return {
    name: 'live-payload',
    configureServer(server) {
      const log = msg => server.config.logger.info(`  [vibestats] ${msg}`);

      // Kick the first build off at startup so the page has fresh data by the
      // time the browser asks for it.
      if (!useFixture) runLiveBuild(log);
      else log('VIBESTATS_FIXTURE=1 — serving the checked-in sample payload');

      server.middlewares.use('/payload.json', async (req, res) => {
        const forceRebuild = /[?&]rebuild=1(&|$)/.test(req.url || '');
        if (!useFixture) {
          if (forceRebuild || pending) await runLiveBuild(log);
        }
        let body = null;
        let source = 'fixture';
        if (!useFixture) {
          try { body = fs.readFileSync(aggPath(), 'utf8'); source = 'live'; } catch { /* fall through */ }
        }
        if (body === null) {
          try { body = fs.readFileSync(FIXTURE, 'utf8'); } catch {
            res.statusCode = 500;
            res.end('{"error":"no payload: live build failed and fixture is missing"}');
            return;
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Vibestats-Payload-Source', source);
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  root: 'dev/dashboard-preview',
  server: {
    port: 49279,
    fs: { allow: ['../..'] },
  },
  plugins: [inlineDashboardTemplate(), livePayload()],
});
