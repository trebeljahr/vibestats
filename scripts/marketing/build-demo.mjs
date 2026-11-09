#!/usr/bin/env node
// Rebuilds the public demo at site/public/demo/index.html from the fictional
// history the marketing screenshots use.
//
//   pnpm demo:build
//
// demo-history.mjs writes the history into a new temp dir and build-all.sh
// builds it there with VIBESTATS_DATA_DIR and HOME=/home/demo. Your own
// ~/.claude, ~/.codex, ~/.gemini and ~/.vibestats are never read.
//
// The page is the combined dashboard with two changes to its payload:
// summary.demo is set, so the header says "fictional demo data" instead of
// counting the days since the snapshot, and the build timestamps are pinned
// to the snapshot day. The same seed gives the same file.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildDemoDashboards, SNAPSHOT_DATE } from './demo-history.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(CODE_ROOT, 'site', 'public', 'demo', 'index.html');
const require = createRequire(import.meta.url);
const { renderTemplate } = require('../lib/render-template.js');

const dataDir = buildDemoDashboards();
try {
  const payload = JSON.parse(fs.readFileSync(path.join(dataDir, 'data', 'combined-agg.json'), 'utf8'));
  const pinned = `${SNAPSHOT_DATE}T00:00:00.000Z`;
  payload.summary.demo = true;
  payload.summary.generatedAt = pinned;
  for (const tool of Object.values(payload.summary.perTool || {})) {
    if (tool && 'generatedAt' in tool) tool.generatedAt = pinned;
  }
  // Same title swap build-combined-dashboard.js makes; the heading follows it.
  const html = renderTemplate(payload, { '<title>Claude Code stats</title>': '<title>AI usage — combined</title>' });
  if (html.includes(dataDir)) throw new Error('demo page would contain the temp data dir path');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log('wrote', path.relative(CODE_ROOT, OUT), `(${payload.heatmap.length} active days, ${payload.summary.firstDay} → ${payload.summary.lastDay})`);
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}
