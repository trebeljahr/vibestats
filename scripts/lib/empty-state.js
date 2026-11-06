// Render a friendly empty-state dashboard when there is no data yet.
// Called by build-*-dashboard.js when no snapshot or no active days exist —
// avoids the "tool crashes on first run before you've used Claude" failure mode.

const fs = require('fs');

function emptyStateHtml(opts) {
  const { tool = 'combined', dataRoot, sourceHint } = opts;
  const niceTool = tool === 'claude-web' ? 'claude.ai web chats' : tool.replace(/^./, c => c.toUpperCase());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vibestats — no data yet</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%230d1117'/%3E%3Crect x='14' y='62' width='14' height='24' rx='2' fill='%2339d353'/%3E%3Crect x='32' y='44' width='14' height='42' rx='2' fill='%2326a641'/%3E%3Crect x='50' y='28' width='14' height='58' rx='2' fill='%23006d32'/%3E%3Crect x='68' y='14' width='14' height='72' rx='2' fill='%230e4429'/%3E%3C/svg%3E">
<meta name="vibestats-empty-state" content="true">
<style>
  /* Same tokens as the dashboard; follows the OS theme. */
  :root { color-scheme: dark; --bg: #0d1117; --fg: #e6edf3; --fg-soft: #c9d1d9; --muted: #9198a1; --card: #161b22; --subtle: #1c2128; --border: #30363d; --hint-bg: #0d2818; --hint-edge: #39d353; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --bg: #f6f8fa; --fg: #1f2328; --fg-soft: #1f2328; --muted: #59636e; --card: #ffffff; --subtle: #eff2f5; --border: #d1d9e0; --hint-bg: #dafbe1; --hint-edge: #1f883d; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 32px 40px; max-width: 640px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { color: var(--muted); margin: 8px 0; }
  code, kbd { background: var(--subtle); padding: 2px 8px; border-radius: 4px; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); }
  .hint { margin-top: 24px; padding: 16px; background: var(--hint-bg); border-left: 3px solid var(--hint-edge); border-radius: 6px; font-size: 13px; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; color: var(--fg-soft); }
</style>
</head>
<body>
<div class="card">
  <h1>No ${niceTool} data yet</h1>
  <p>Vibestats found no usage transcripts to display. This is expected if:</p>
  <ul>
    <li>You just installed vibestats and haven't used the tool yet.</li>
    <li>You use a tool vibestats doesn't read from (yet).</li>
    <li>Your data lives in a non-standard location.</li>
  </ul>
  <div class="hint">
    <strong>Try:</strong>
    <ul>
      <li>Use Claude Code or Codex for a session, then run <code>vibestats</code> again.</li>
      <li>Check that <code>${sourceHint || '~/.claude/projects/'}</code> exists and is readable.</li>
      <li>Inspect <code>${dataRoot}/snapshots/</code> — is the latest snapshot empty?</li>
    </ul>
  </div>
  <p style="margin-top: 24px;">Data dir: <code>${dataRoot}</code></p>
</div>
</body>
</html>
`;
}

function writeEmptyState(outPath, opts) {
  fs.writeFileSync(outPath, emptyStateHtml(opts));
  console.log(`Wrote empty-state dashboard to ${outPath}`);
}

module.exports = { emptyStateHtml, writeEmptyState };
