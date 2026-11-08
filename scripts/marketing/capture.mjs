#!/usr/bin/env node
// Rebuilds the README screenshots and the GitHub social-preview cards in
// docs/marketing/ from fictional data.
//
//   pnpm marketing:capture                 # screenshots + social previews
//   pnpm marketing:capture shots           # screenshots only
//   pnpm marketing:capture social          # social previews only
//
// Screenshots: writes a fictional history (demo-history.mjs) into a new temp
// dir, runs the normal builders against it with VIBESTATS_DATA_DIR and
// HOME=/home/demo, then opens combined-dashboard.html in headless Chromium,
// once with the OS set to dark and once set to light. Dark shots keep their
// plain names; light shots get a `-light` suffix.
// Your own ~/.claude, ~/.codex, ~/.gemini and ~/.vibestats are never read.
//
// Needs Playwright. It is not a dependency of this repo: install it globally
// (`npm i -g playwright && npx playwright install chromium`), run with
// NODE_PATH pointing at a node_modules that has playwright or playwright-core,
// or set PLAYWRIGHT_MODULE to the package directory. When Playwright's own
// Chromium build is missing, it falls back to CHROMIUM_PATH if set, then to
// an installed Google Chrome (headless).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeDemoHistory, DEMO_HOME, SNAPSHOT_DATE } from './demo-history.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(CODE_ROOT, 'docs', 'marketing');
const SHOTS = path.join(OUT, 'screenshots');
const SOCIAL = path.join(OUT, 'social-preview');
// The desktop app opens at 1280×900 and the dashboard body is 1280px wide.
const VIEWPORT = { width: 1280, height: 900 };
const SCALE = 2;
// Pin the page clock to the snapshot day so the header shows no "N days old"
// badge and month-based ranges line up with the fictional history.
const CLOCK = new Date(`${SNAPSHOT_DATE}T16:00:00`);

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch { /* next */ }
  }
  const candidates = [];
  try { candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* no npm */ }
  try {
    // The `playwright` CLI on PATH lives at <pkg>/cli.js behind a bin symlink.
    const bin = execFileSync('which', ['playwright'], { encoding: 'utf8' }).trim();
    if (bin) candidates.push(path.dirname(fs.realpathSync(bin)));
  } catch { /* not on PATH */ }
  for (const dir of candidates) {
    try { return require(dir); } catch { /* next */ }
  }
  console.error('Playwright not found. Install it with `npm i -g playwright && npx playwright install chromium`.');
  process.exit(1);
}

function buildDemoDashboards() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibestats-demo-'));
  const counts = writeDemoHistory(dataDir);
  console.log('fictional history:', counts);
  const env = { ...process.env, HOME: DEMO_HOME, VIBESTATS_DATA_DIR: dataDir };
  for (const key of ['VIBESTATS_LIVE', 'GOOSE_PATH_ROOT', 'CLAUDE_SESSION_KEY']) delete env[key];
  const r = spawnSync('bash', [path.join(CODE_ROOT, 'scripts', 'build-all.sh')], { env, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error('build-all.sh failed on the fictional history');
  }
  return dataDir;
}

async function toWebp(pngBuffer, file) {
  const tmp = file.replace(/\.webp$/, '.tmp.png');
  fs.writeFileSync(tmp, pngBuffer);
  execFileSync('cwebp', ['-quiet', '-q', '90', '-m', '6', tmp, '-o', file]);
  fs.unlinkSync(tmp);
}

// The dashboard follows prefers-color-scheme unless its toggle pins a theme,
// and a fresh browser context has nothing pinned, so emulating the OS setting
// is enough to get each theme.
const THEMES = [
  { scheme: 'dark', suffix: '' },
  { scheme: 'light', suffix: '-light' },
];

async function launchBrowser(chromium) {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist/.test(String(e && e.message))) throw e;
    console.log("Playwright's Chromium build is missing; using installed Google Chrome (headless).");
    return chromium.launch({ channel: 'chrome' });
  }
}

async function captureScreenshots(browser) {
  const dataDir = buildDemoDashboards();
  fs.mkdirSync(SHOTS, { recursive: true });
  const shots = [];
  for (const theme of THEMES) shots.push(...await captureTheme(browser, dataDir, theme));
  fs.rmSync(dataDir, { recursive: true, force: true });
  return shots;
}

async function captureTheme(browser, dataDir, { scheme, suffix }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: scheme });
  const page = await context.newPage();
  await page.clock.setFixedTime(CLOCK);
  await page.goto(pathToFileURL(path.join(dataDir, 'combined-dashboard.html')).href);
  await page.waitForSelector('#cells .cell');
  const shots = [];
  const save = async (base, buffer, alt) => {
    const name = base + suffix;
    const file = path.join(SHOTS, `${name}.webp`);
    await toWebp(buffer, file);
    shots.push({ name, file, alt: `${alt} ${scheme === 'light' ? 'Light' : 'Dark'} theme.` });
    console.log('wrote', path.relative(CODE_ROOT, file));
  };

  await save('dashboard-overview', await page.screenshot(),
    'Combined dashboard: stat cards for active days, streaks, sessions, tokens, API cost, subscription paid and value multiple, above a year-long activity heatmap.');

  await save('activity-heatmap', await page.locator('.heatmap-wrap').screenshot(),
    'Activity heatmap from January to October, one square per day, a stronger green on days with more sessions.');

  // Per-day breakdown: open the busiest weekday in the last month.
  const busiest = await page.evaluate(() => {
    const days = window.__VIBESTATS_DATA.heatmap.filter(d => d.day >= '2026-10-01');
    return days.sort((a, b) => b.sessions - a.sessions || b.messages - a.messages)[0].day;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  const cell = page.locator(`#cells .cell[data-day="${busiest}"]`);
  if (await cell.count()) await cell.click();
  else await page.locator('#cells .cell.l4').last().click();
  await page.waitForSelector('#dayPanel.open');
  await save('day-breakdown', await page.screenshot(),
    'Per-day breakdown dialog: sessions, messages, tokens and API cost for one day, split by project and by model.');
  await page.keyboard.press('Escape');

  await page.locator('h2', { hasText: 'Models' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find(el => el.textContent.startsWith('Models'));
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 24);
  });
  await save('models-and-projects', await page.screenshot(),
    'Models table with messages, input, output, cache reads and writes and API cost per model, above the top projects table.');

  await context.close();
  return shots;
}

async function renderSocialPreviews(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const out = [];
  for (const variant of ['a', 'b', 'c']) {
    await page.goto(pathToFileURL(path.join(SOCIAL, 'template.html')).href + `?v=${variant}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(img => img.complete));
    const file = path.join(SOCIAL, `social-preview-${variant}.png`);
    await page.screenshot({ path: file });
    out.push({ name: `social-preview-${variant}`, file });
    console.log('wrote', path.relative(CODE_ROOT, file));
  }
  await context.close();
  return out;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function webpSize(file) {
  const b = fs.readFileSync(file);
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return {};
}

function writeManifest() {
  const entries = [];
  const describe = (dir, how) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (!/\.(webp|png)$/.test(name)) continue;
      const size = name.endsWith('.png') ? pngSize(file) : webpSize(file);
      entries.push({
        file: path.relative(OUT, file),
        ...(dir === SHOTS ? { theme: /-light\.webp$/.test(name) ? 'light' : 'dark' } : {}),
        width: size.width,
        height: size.height,
        bytes: fs.statSync(file).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        source: how,
      });
    }
  };
  describe(SHOTS, `combined-dashboard.html built by scripts/build-all.sh from the fictional history in scripts/marketing/demo-history.mjs (snapshot ${SNAPSHOT_DATE}), captured by scripts/marketing/capture.mjs in headless Chromium at ${VIEWPORT.width}x${VIEWPORT.height}, scale ${SCALE}, with prefers-color-scheme set to the listed theme`);
  describe(SOCIAL, 'social-preview/template.html rendered by scripts/marketing/capture.mjs at 1280x640, using the screenshots above');
  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    data: 'Fictional. Every project name, path and number comes from a seeded generator, not from real usage.',
    files: entries,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('wrote docs/marketing/manifest.json');
}

const mode = process.argv[2] || 'all';
const { chromium } = loadPlaywright();
const browser = await launchBrowser(chromium);
try {
  if (mode === 'all' || mode === 'shots') await captureScreenshots(browser);
  if (mode === 'all' || mode === 'social') await renderSocialPreviews(browser);
  writeManifest();
} finally {
  await browser.close();
}
