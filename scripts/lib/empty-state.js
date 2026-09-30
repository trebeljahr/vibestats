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
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.6 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px 40px; max-width: 640px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { color: #7d8590; margin: 8px 0; }
  code, kbd { background: #1c2128; padding: 2px 8px; border-radius: 4px; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #e6edf3; }
  .hint { margin-top: 24px; padding: 16px; background: #0d2818; border-left: 3px solid #39d353; border-radius: 6px; font-size: 13px; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; color: #c9d1d9; }
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
