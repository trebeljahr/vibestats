const fs = require('fs');
const { TEMPLATE_PATH, SCRIPT_PATH } = require('./paths');

// HTML parses script boundaries before JavaScript parses strings. Unicode
// escapes preserve payload values without leaving HTML syntax in the source.
function serializeInlineData(payload) {
  return JSON.stringify(payload)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Inline scripts/dashboard-template.js into the HTML template at the
// /* __SCRIPT__ */ placeholder, then substitute the payload at __DATA__.
// Optional `replacements` map applies additional string -> string swaps
// (used by per-tool builders to rewrite the page <title>, etc.).
function renderTemplate(payload, replacements = {}) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const scriptBody = fs.readFileSync(SCRIPT_PATH, 'utf8');
  let html = template
    .replace('/* __SCRIPT__ */', () => scriptBody)
    .replace('__DATA__', () => serializeInlineData(payload));
  for (const [from, to] of Object.entries(replacements)) {
    html = html.replace(from, () => to);
  }
  return html;
}

module.exports = { renderTemplate };
