#!/usr/bin/env node
/*
 * release-bump — bump package.json + commit + tag, atomically.
 *
 * Adapted from hatchkit/cli/scripts/release-bump.mjs. Replaces
 * `npm version <bump>` because npm's built-in command misbehaves
 * in some workspace layouts and silently skips commit/tag steps.
 * Doing it ourselves is unambiguous: bump, stage, commit, tag.
 *
 * Usage: node scripts/release-bump.mjs <patch|minor|major>
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pkgPath = join(repoRoot, "package.json");

const bumpKind = process.argv[2];
if (!["patch", "minor", "major"].includes(bumpKind)) {
  console.error(`release-bump: expected patch|minor|major, got ${bumpKind ?? "(nothing)"}`);
  process.exit(1);
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", ...opts }).trim();
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = pkg.version;
const [maj, min, pat] = current.split(".").map((n) => Number(n) || 0);
const next =
  bumpKind === "major" ? `${maj + 1}.0.0`
  : bumpKind === "minor" ? `${maj}.${min + 1}.0`
  : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

// Mirror version into src-tauri/Cargo.toml + tauri.conf.json so the
// desktop binary's reported version matches the npm package.
const cargoPath = join(repoRoot, "src-tauri", "Cargo.toml");
try {
  const cargo = readFileSync(cargoPath, "utf-8");
  const updated = cargo.replace(/^version = "[^"]*"/m, `version = "${next}"`);
  if (updated !== cargo) writeFileSync(cargoPath, updated, "utf-8");
} catch { /* no tauri yet — skip */ }

const tauriConfPath = join(repoRoot, "src-tauri", "tauri.conf.json");
try {
  const conf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
  conf.version = next;
  writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, "utf-8");
} catch { /* no tauri yet — skip */ }

console.log(`  release-bump: ${current} → ${next}`);

// Stage only the version-bearing files that actually exist
const toAdd = ["package.json"];
if (existsSync(join(repoRoot, "src-tauri", "Cargo.toml"))) toAdd.push("src-tauri/Cargo.toml");
if (existsSync(join(repoRoot, "src-tauri", "tauri.conf.json"))) toAdd.push("src-tauri/tauri.conf.json");
sh(`git add ${toAdd.join(" ")}`, { cwd: repoRoot });
sh(`git commit -m "chore: release v${next}"`, { cwd: repoRoot });
sh(`git tag v${next}`, { cwd: repoRoot });
console.log(`  release-bump: committed + tagged v${next}`);
