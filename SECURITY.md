# Security Policy

## Reporting a Vulnerability

If you find a security issue in vibestats, please report it privately. Do **not** open a public GitHub issue.

Two channels:

1. **Email** — `ricotrebeljahr@gmail.com`. PGP not required; just describe the issue.
2. **GitHub Security Advisories** — <https://github.com/trebeljahr/vibestats/security/advisories/new> (private until disclosed).

Please include:

- A description of the issue and its impact.
- A minimal reproduction (commands, file contents, snapshot fixtures if relevant — redact any real data).
- The vibestats version (`vibestats --version`) and platform (macOS / Linux / Windows; CLI / Tauri).

Expect a first response within 7 days. Coordinated disclosure preferred — give us a chance to ship a fix before going public.

## Supported Versions

Pre-1.0, only the **latest** released version is supported. Backports to older 0.x.y versions are not provided. After 1.0, this section will be revised.

| Version | Supported |
| ------- | --------- |
| latest  | yes       |
| older   | no — upgrade to latest |

## Scope

In scope:

- The **vibestats CLI** (`bin/cli.js` and everything it dispatches: `snapshot`, `build`, `serve`, `fetch-web`, `prices`, `merges`, `redact`, etc.).
- The **Tauri desktop app** (`src-tauri/`) and its bundled IPC commands.
- The **npm package** (`@trebeljahr/vibestats`) — install-time + runtime behavior.
- The **Homebrew formula** (`Formula/vibestats.rb`) — install-time behavior.
- The **GitHub Actions release pipeline** (`.github/workflows/release.yml`) insofar as it produces the artifacts above.

Out of scope:

- **Content of user transcripts.** Whatever the user pasted into Claude Code / Codex / Gemini / Goose / Cline / claude.ai is treated as owner-trusted input. We do not parse it for safety; if your own chat history contains something dangerous, that's on you.
- **AI provider safety / content moderation.** Issues with Anthropic, OpenAI, Google, or any other model provider belong to that provider.
- **Third-party tools vibestats reads from.** Bugs or vulnerabilities in Claude Code, Codex CLI, Cursor, Gemini CLI, Goose, Cline / Roo / Kilo, or any future tool we add a parser for — report those upstream. We only read the files they write.
- **Local resource exhaustion** from your own data (e.g., a 10 GB transcript dir slowing snapshot). Not a security issue.
- **Issues that require the attacker to already control your user account or filesystem.** If they're already root on your laptop, vibestats is the least of your worries.

## Threat Model (Summary)

vibestats is a **local read-only analyzer of files the operator already owns**. The trust boundary is the operator's filesystem.

- A "malicious snapshot" is **owner-trusted input** — it's the operator's own transcript data. We do not treat snapshots as adversarial; we do not run user-supplied JS, evaluate user-supplied templates, or shell out with user-supplied strings.
- vibestats is **not a sandbox for hostile data**. If you point it at a directory full of attacker-controlled JSONL crafted to exploit a parser, that's outside the threat model. (We will still fix the parser bug — but it's not a "vibestats was breached" event.)
- Generated dashboards are **static HTML for local viewing**. They embed raw project names + timestamps. Posting them on the public internet (or serving via `serve.sh` on `0.0.0.0`) is the operator's choice; the defaults bind to `127.0.0.1` and the `redact` subcommand is available for sanitization.
- We assume the **OS perm boundary holds**. Data dir is `0700`, configs are `0600`. If another local user on the same machine reads `~/.vibestats/`, the OS perms failed, not vibestats.

What we *do* defend against:

- Accidentally shipping user data in the npm tarball (`release-prep.mjs` tarball audit).
- Accidentally exposing the dashboard to the network (`serve.sh` binds `127.0.0.1` by default).
- Accidentally embedding executable script in dashboards (CSP in Tauri; static HTML elsewhere).
- Accidentally making outbound network calls (none in normal operation; opt-in only for `fetch-web` and `prices update`). See [PRIVACY.md](PRIVACY.md) for the full list.

See [PRIVACY.md](PRIVACY.md) for the broader threat model, actor list, and data flow diagram.
