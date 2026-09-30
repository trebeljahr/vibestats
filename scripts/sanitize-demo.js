#!/usr/bin/env node
// Public demo uses fictional inputs only. Never read the operator's data directory.
const fs = require('fs');
const path = require('path');
const { renderTemplate } = require('./lib/render-template');
const root = path.resolve(__dirname, '..');
const payload = JSON.parse(fs.readFileSync(path.join(root, 'dev/dashboard-preview/sample-payload.json'), 'utf8'));
const output = path.join(root, 'site/public/demo/index.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, renderTemplate(payload));
console.log('Wrote demo from fictional fixture.');
