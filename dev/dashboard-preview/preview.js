// Dev-only entry point for the dashboard. Fetches the payload from the dev
// server (vite.config.js's live-payload plugin builds it from the live
// ~/.claude / ~/.codex / ~/.gemini dirs, falling back to sample-payload.json),
// then imports the same dashboard JS the production build inlines into
// scripts/dashboard-template.html. Editing scripts/dashboard-template.js
// triggers Vite HMR / full reload.
const res = await fetch('/payload.json');
if (!res.ok) throw new Error(`payload.json: ${res.status} ${res.statusText}`);
window.__VIBESTATS_DATA = await res.json();
if (res.headers.get('X-Vibestats-Payload-Source') === 'fixture') {
  console.warn('[vibestats] showing the sample fixture, not your real usage — see the dev server log for why');
}
await import('../../scripts/dashboard-template.js');
