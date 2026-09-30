# Privacy boundaries

Personal history stays on the operator's machine. New installs use `~/.vibestats`, an explicit `VIBESTATS_DATA_DIR` takes priority, and existing clones with `pricing.json` retain their current data location. Upgrades do not migrate or erase that history.

Snapshots copy locally available tool data. Missing sources are skipped. Refreshing a snapshot does not delete older copied files when a source disappears. Raw transcripts can contain pasted credentials, paths and private conversations. Do not commit or upload them.

The source repository and npm package exclude snapshots, aggregates, generated dashboards, pricing configuration, project aliases, pending merge decisions, credentials and private backups. Ignore rules only affect untracked files. Earlier Git commits and branches require separate review before publication.

`npm run privacy:check` and the packaging guard catch known private paths and selected user-directory patterns. These checks are defense in depth, not a complete secret scan. Only fictional fixtures belong in source control. The public demo is generated from a fictional fixture rather than personal usage.

`vibestats serve` is loopback-only and serves named dashboard HTML files. It does not serve raw snapshots, JSON configuration, symlinks or arbitrary paths. Other processes running as the same user remain trusted; the OS account is the local security boundary.

`vibestats redact` pseudonymizes project names and manifest paths. Optional date coarsening reduces detail. Usage counts, costs and model names remain. Review exports before sharing and serve them behind authentication when appropriate. Redaction cannot guarantee anonymity. Never upload the entire data directory.

Normal snapshot and parsing work reads local files. `fetch-web` explicitly contacts the provider using credentials supplied by the operator; `prices update` explicitly retrieves public pricing data. Package installation and release tooling also contact distribution services. No publishing is required to use local usage statistics.

Build and release dependencies remain trusted code. No claim of verified signing, hosted access controls or complete protection against malicious local input is made here.
