#!/usr/bin/env node
// vibestats CLI. Subcommands:
//   init        seed config + create ~/.vibestats
//   snapshot    rsync ~/.claude, ~/.codex, ~/.gemini into a dated snapshot dir
//   build       rebuild all dashboards from latest snapshot (--live: from live dirs)
//   live        rebuild from live dirs + open — no snapshot, seconds instead of GBs
//   open        open combined dashboard in default browser
//   serve       run a tiny localhost HTTP server over the data dir
//   fetch-web   pull claude.ai web chat history (requires CLAUDE_SESSION_KEY)
//   all         snapshot + build + open  (default if no subcommand given)

const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const { CODE_ROOT, DATA_ROOT, ensureDataRoot } = require('../scripts/lib/paths');

const SCRIPTS = path.join(CODE_ROOT, 'scripts');

// `--live` makes every downstream script read ~/.claude, ~/.codex, ~/.gemini
// directly instead of the newest snapshot. Passed down as an env var because
// snapshot.sh, build-all.sh and the node builders all consult the same resolver
// (scripts/lib/sources.js).
const args = process.argv.slice(3);
const LIVE = args.includes('--live');
const passthroughArgs = args.filter(a => a !== '--live');
const childEnv = LIVE ? { ...process.env, VIBESTATS_LIVE: '1' } : process.env;

function runNode(scriptName, extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, scriptName), ...extraArgs], { stdio: 'inherit', env: childEnv });
  if (r.status !== 0) process.exit(r.status || 1);
}
function runBash(scriptName, env = childEnv) {
  const r = spawnSync('bash', [path.join(SCRIPTS, scriptName)], { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status || 1);
}
function runBashLive(scriptName) {
  return runBash(scriptName, { ...process.env, VIBESTATS_LIVE: '1' });
}
function runNodeLive(scriptName, extraArgs = []) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, scriptName), ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, VIBESTATS_LIVE: '1' },
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const cmd = process.argv[2] || 'all';

function help() {
  console.log(`vibestats — local dashboard for Claude Code + Codex + claude.ai web chats

Usage: vibestats [command]

Commands:
  init             Seed config files into ${DATA_ROOT}
  snapshot         Snapshot ~/.claude, ~/.codex, ~/.gemini into a dated snapshot dir
                   (auto-runs detect-pricing afterward)
  build            Rebuild dashboards from latest snapshot
                   --live                  read ~/.claude, ~/.codex, ~/.gemini directly
                                           instead of the newest snapshot
  live             build --live + open. Seconds, no ~2GB snapshot copy — use this
                   when the dashboard looks out of date
  detect-pricing   Re-run subscription tier detection from latest snapshot
  open             Open combined dashboard in default browser
  serve            Run a localhost HTTP server over the data dir
  fetch-web        Pull claude.ai web chat history (set CLAUDE_SESSION_KEY first)
  redact           Generate shareable redacted-*.html dashboards (project names hashed)
                   --check                scan latest snapshot for secret patterns, exit non-zero on hits
                   --coarsen-dates=week|month  also bucket the heatmap to hide daily patterns
  merges           Review medium-confidence project merge candidates
                   list                    show pending merges (default)
                   accept <id>             merge pair into project-aliases.json
                   reject <id>             drop from pending list
                   clear                   drop all pending
  detect-merges    Re-scan for merge candidates (auto-run by 'all' after build)
  prices           Manage model pricing cache (LiteLLM)
                   update                  fetch latest prices (opt-in; default subcommand)
                   show                    list cached prices for models you've used
  all              snapshot + detect-pricing + build + detect-merges + open  (default)
  help             Show this message

Data dir: ${DATA_ROOT}
Override with VIBESTATS_DATA_DIR.
`);
}

switch (cmd) {
  case 'init':
    ensureDataRoot();
    console.log(`Initialized ${DATA_ROOT}`);
    console.log('  Edit pricing.json to set your subscription tier + start date.');
    console.log('  Edit project-aliases.json to merge renamed projects.');
    break;
  case 'snapshot':
    ensureDataRoot();
    runBash('snapshot.sh');
    // After every snapshot, refresh auto-detected pricing (idempotent — skips if user-edited)
    runNode('detect-subscription.js');
    break;
  case 'detect-pricing':
    ensureDataRoot();
    runNode('detect-subscription.js');
    break;
  case 'build':
    ensureDataRoot();
    runBash('build-all.sh');
    break;
  case 'live':
    // Rebuild straight from the live dirs, then open. No rsync, so this is the
    // cheap way to see today's sessions.
    ensureDataRoot();
    runNodeLive('detect-subscription.js');
    runBashLive('build-all.sh');
    runNodeLive('detect-merges.js');
    runBash('open.sh', process.env);
    break;
  case 'open':
    runBash('open.sh');
    break;
  case 'serve':
    runBash('serve.sh');
    break;
  case 'fetch-web':
  case 'fetch':
    ensureDataRoot();
    runNode('fetch-claude-web.js');
    break;
  case 'redact':
    ensureDataRoot();
    runNode('redact.js', passthroughArgs);
    break;
  case 'merges':
    ensureDataRoot();
    runNode('merges.js', passthroughArgs);
    break;
  case 'detect-merges':
    ensureDataRoot();
    runNode('detect-merges.js');
    break;
  case 'prices': {
    ensureDataRoot();
    const sub = process.argv[3] || 'update';
    if (sub === 'update') {
      runNode('prices-update.js');
    } else if (sub === 'show') {
      runNode('prices-show.js');
    } else {
      console.error(`Unknown prices subcommand "${sub}". Use update | show.`);
      process.exit(1);
    }
    break;
  }
  case 'all':
  case undefined:
    ensureDataRoot();
    runBash('snapshot.sh');
    runNode('detect-subscription.js');
    runNode('detect-merges.js');
    runBash('build-all.sh');
    runBash('open.sh');
    break;
  case 'help':
  case '-h':
  case '--help':
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
