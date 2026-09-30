#!/usr/bin/env node
/*
 * release-prep — strict pre-release verification.
 *
 * Refuses to release if the working tree has uncommitted or untracked
 * changes. Also refuses when the local package.json version is at-or-
 * behind the version published to npm (release-bump.mjs increments
 * from the LOCAL version, so drift would generate a number that's
 * already taken).
 *
 * Skip with RELEASE_SKIP_PREP=1. RELEASE_SKIP_NPM_CHECK=1 only skips
 * the npm-version comparison, useful offline.
 *
 * Adapted from hatchkit/cli/scripts/release-prep.mjs (single-package layout).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.RELEASE_SKIP_PREP === "1") {
  console.log("  release-prep: RELEASE_SKIP_PREP=1 — skipping.");
  process.exit(0);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", ...opts }).trim();
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

let status;
try {
  status = sh("git status --porcelain", { cwd: repoRoot });
} catch (err) {
  console.error(`  release-prep: couldn't read repo: ${err.message}`);
  process.exit(1);
}

if (status) {
  console.error("\n  ✗ release-prep: cannot release — uncommitted changes.\n");
  for (const line of status.split("\n")) console.error(`      ${line}`);
  console.error("\n  Commit or stash, then re-run.\n");
  process.exit(1);
}

if (process.env.RELEASE_SKIP_NPM_CHECK !== "1") {
  const driftError = checkNpmDrift(repoRoot);
  if (driftError) {
    console.error(`\n  ✗ release-prep: ${driftError}\n`);
    process.exit(1);
  }
}

if (process.env.RELEASE_SKIP_CHANGELOG_CHECK !== "1") {
  const changelogError = checkUnreleasedChangelog(repoRoot);
  if (changelogError) {
    console.error(`\n  ✗ release-prep: ${changelogError}\n`);
    process.exit(1);
  }
}

if (process.env.RELEASE_SKIP_TARBALL_AUDIT !== "1") {
  const tarballError = auditTarball(repoRoot);
  if (tarballError) {
    console.error(`\n  ✗ release-prep: ${tarballError}\n`);
    process.exit(1);
  }
}

console.log("  ✓ release-prep: tree clean, changelog ready, npm in sync, tarball clean. Continuing.");
process.exit(0);

/** Refuse to cut a release when CHANGELOG.md's `## [Unreleased]` section is
 *  empty. Without this, every release ships an empty release body (the GH
 *  Actions workflow's releaseBody says "See CHANGELOG for details"). */
function checkUnreleasedChangelog(repoRoot) {
  const path = join(repoRoot, "CHANGELOG.md");
  if (!existsSync(path)) {
    return "CHANGELOG.md is missing — create one (see https://keepachangelog.com) before releasing.";
  }
  let text;
  try { text = readFileSync(path, "utf-8"); }
  catch (err) { return `couldn't read CHANGELOG.md — ${err.message}`; }
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => /^##\s+\[Unreleased\]/i.test(l));
  if (startIdx === -1) {
    return "CHANGELOG.md has no `## [Unreleased]` section — add one before releasing.";
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+\[/.test(lines[i])) { endIdx = i; break; }
  }
  const body = lines.slice(startIdx + 1, endIdx)
    .filter((line) => !/^\s*$/.test(line) && !/^\s*<!--/.test(line))
    .join("\n")
    .trim();
  if (!body) {
    return [
      "CHANGELOG.md `[Unreleased]` section is empty.",
      "",
      "  Fill it in (Added / Changed / Fixed / Security) — the GitHub Release body",
      "  links here. Or set RELEASE_SKIP_CHANGELOG_CHECK=1 to bypass.",
    ].join("\n");
  }
  return null;
}

/** Run `npm pack --dry-run` and fail if any forbidden patterns appear.
 *  Defends against accidental shipping of user data, snapshots, or
 *  generated dashboards. */
function auditTarball(repoRoot) {
  let listing;
  try {
    listing = sh("npm pack --dry-run --json", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    return `npm pack --dry-run failed: ${err.message}`;
  }
  let files;
  try {
    const parsed = JSON.parse(listing);
    files = (parsed[0] && parsed[0].files) || [];
  } catch (err) {
    return `couldn't parse npm pack output: ${err.message}`;
  }
  const FORBIDDEN = [
    /(^|\/)pending-merges\.json$/,
    /(^|\/)redacted-.*\.html$/,
    /\.(?:sqlite|db|bundle|pem|key)$/,
    /(^|\/)snapshots\//,
    /(^|\/)data\//,
    /\.jsonl$/,
    /\.backup\./,
    /\.iconset\//,
    /(^|\/)dashboard\.html$/,
    /(^|\/)codex-dashboard\.html$/,
    /(^|\/)combined-dashboard\.html$/,
    /(^|\/)claude-web-dashboard\.html$/,
    /(^|\/)gemini-dashboard\.html$/,
    /(^|\/)goose-dashboard\.html$/,
    /(^|\/)cline-dashboard\.html$/,
    /(^|\/)pricing\.json$/,           // example.json fine; the real one isn't
    /(^|\/)pricing-cache\.json$/,     // LiteLLM cache is user-fetched, regenerable
    /(^|\/)project-aliases\.json$/,
    /\.claude-stats-config\.json$/,
    /(^|\/)\.git\//,
  ];
  const violations = [];
  for (const f of files) {
    const p = f.path || f;
    for (const pat of FORBIDDEN) {
      if (pat.test(p)) { violations.push(p); break; }
    }
  }
  if (violations.length) {
    return [
      `tarball contains ${violations.length} forbidden file(s):`,
      ...violations.slice(0, 20).map((v) => `      ${v}`),
      violations.length > 20 ? `      ... and ${violations.length - 20} more` : "",
      "",
      "  Fix the `files` whitelist in package.json or .npmignore and retry.",
    ].filter(Boolean).join("\n");
  }
  return null;
}

function checkNpmDrift(repoRoot) {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf-8")); }
  catch (err) { return `couldn't parse package.json — ${err.message}`; }
  const local = pkg.version;
  const name = pkg.name;
  if (!local || !name) return null;

  let registry;
  try {
    registry = sh(`npm view ${name} version`, { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // 404 = first publish, fine
  }
  if (!registry) return null;

  if (compareSemver(local, registry) < 0) {
    return [
      `local ${name}@${local} is behind the registry's ${registry}.`,
      "",
      "  Sync first:",
      `      npm version ${registry} --no-git-tag-version`,
      `      git commit -am "chore: release v${registry}"`,
      `      git tag v${registry}`,
      "",
      "  Then re-run the release.",
    ].join("\n");
  }
  return null;
}

function compareSemver(a, b) {
  const [aa, bb] = [a, b].map((v) => v.split(".").map((n) => Number(n) || 0));
  for (let i = 0; i < 3; i++) {
    if ((aa[i] ?? 0) > (bb[i] ?? 0)) return 1;
    if ((aa[i] ?? 0) < (bb[i] ?? 0)) return -1;
  }
  return 0;
}
