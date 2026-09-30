# CI fixtures

Deterministic snapshots used by `.github/workflows/ci.yml` to exercise
`scripts/redact.js --check`. Not for human use, not shipped to npm
(see the `files` whitelist in [../package.json](../package.json)).

Two fixtures live here:

- `snapshot-fixture/` — clean minimal snapshot (1 fake project,
  2 sessions on 2026-01-01). No secret patterns. `--check` must exit 0.
- `snapshot-with-secret/` — same shape, but one jsonl message contains a
  deliberately-pattern-matching `ghp_FAKE…` string. `--check` must exit
  non-zero. Negative test catches "I broke the regex" regressions.

Project paths are intentionally `/tmp/test-myproj` (not under `/Users/`
or `/home/`) so the macOS/Linux home-path patterns in `redact.js` don't
flag the clean fixture. Never substitute real paths here.

CI invokes `redact.js` with `VIBESTATS_DATA_DIR` pointed at the fixture
root so `SNAP_ROOT` resolves to `<fixture>/snapshots/`.
