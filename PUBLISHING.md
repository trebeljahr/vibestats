# Publishing vibestats

Three distribution channels:

1. **npm** — `npx @trebeljahr/vibestats` or `npm i -g`. CLI users.
2. **Homebrew tap** — `brew install trebeljahr/tap/vibestats`. Mac CLI users.
3. **Tauri desktop app** — DMG/MSI/AppImage via GitHub Releases. Desktop users.

All three pull from the same GitHub repo. The npm + Homebrew flows ship the CLI; the Tauri flow ships a native app that bundles the CLI as a resource.

## 0. One-time setup

### GitHub repo
```bash
gh repo create trebeljahr/vibestats --public --source=. --remote=origin --push
```

### npm trusted publishing
The first version was published from a logged-in machine (`npm publish --access public`). After that, CI publishes with npm trusted publishing (GitHub OIDC), so there is no `NPM_TOKEN` secret:
```bash
npm trust github @trebeljahr/vibestats --repo trebeljahr/vibestats --file release.yml
npm trust list @trebeljahr/vibestats
```
The `publish-npm` job skips the publish when the version is already on npm.

### Homebrew tap repo (one-time)
A tap is just a GitHub repo named `homebrew-<name>` with `Formula/*.rb` files. No Homebrew account — piggybacks on GitHub.

```bash
gh repo create trebeljahr/homebrew-tap --public --description "Personal Homebrew tap"
git clone https://github.com/trebeljahr/homebrew-tap ~/projects/homebrew-tap
mkdir -p ~/projects/homebrew-tap/Formula
```

### Apple codesigning
Signed with the Ricos Labs LLC "Developer ID Application" certificate and notarized with an App Store Connect API key (no Apple ID password). Secrets:
```bash
base64 -i developer-id-application.p12 | gh secret set APPLE_CERTIFICATE
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set APPLE_SIGNING_IDENTITY        # "Developer ID Application: Ricos Labs LLC (4BHY8H2J25)"
gh secret set APPLE_TEAM_ID                 # 4BHY8H2J25
gh secret set APPLE_API_KEY                 # App Store Connect key ID
gh secret set APPLE_API_ISSUER              # App Store Connect issuer ID
base64 -i AuthKey_<KEY_ID>.p8 | gh secret set APPLE_API_KEY_P8_BASE64
```
Without these secrets the macOS build is unsigned, and users must right-click → Open on first launch.

### Tauri update signing (optional, for auto-updates)
If you want in-app auto-updates later:
```bash
node_modules/.bin/tauri signer generate -w ~/.tauri/vibestats.key
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/vibestats.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## 1. Cut a release

Three commands. Works once the one-time setup is done.

```bash
npm run release:patch      # 0.1.0 → 0.1.1
# or release:minor, release:major
```

Under the hood (mirrors hatchkit):
1. **`release-prep.mjs`** — verifies git tree is clean and local version is at-or-ahead of npm registry
2. **`release-bump.mjs`** — bumps `package.json` + `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json` in lockstep, commits, tags `vX.Y.Z`
3. **`_release:finish`** — `git push --follow-tags && npm publish --access public && npm install -g .`

The pushed tag triggers `.github/workflows/release.yml`, which:
- Builds Tauri binaries for macOS arm64 + x64, Linux x64, Windows x64
- Attaches DMG/AppImage/MSI to the GitHub Release for that tag
- Publishes the npm package through trusted publishing, or skips it when the version is already on npm

You don't have to do anything else for npm + desktop binaries.

## 2. Update the Homebrew tap

The Homebrew formula needs the new release tarball's SHA256. One command in the tap repo:

```bash
cd ~/projects/homebrew-tap
VERSION="0.1.1"
SHA=$(curl -fsSL https://github.com/trebeljahr/vibestats/archive/refs/tags/v${VERSION}.tar.gz | shasum -a 256 | awk '{print $1}')

# Copy the latest formula from the vibestats repo
cp ~/projects/vibestats/Formula/vibestats.rb Formula/vibestats.rb

# Update version + sha
sed -i '' "s|v[0-9]*\.[0-9]*\.[0-9]*|v${VERSION}|g" Formula/vibestats.rb
sed -i '' "s|sha256 \".*\"|sha256 \"${SHA}\"|" Formula/vibestats.rb

git commit -am "vibestats ${VERSION}"
git push
```

Existing users: `brew upgrade vibestats`.

## 3. First-time install instructions (for your README / users)

```bash
# Option A — CLI via npx (no install)
npx @trebeljahr/vibestats

# Option B — CLI via npm global
npm install -g @trebeljahr/vibestats
vibestats

# Option C — CLI via Homebrew
brew tap trebeljahr/tap
brew install vibestats
vibestats

# Option D — Desktop app
# Download the DMG/MSI/AppImage from
#   https://github.com/trebeljahr/vibestats/releases/latest
```

## Verifying everything works locally before publishing

```bash
# npm package
npm pack
npm install -g ./trebeljahr-vibestats-0.1.0.tgz
vibestats help
npm uninstall -g @trebeljahr/vibestats

# Homebrew formula (without setting up a tap)
brew install --build-from-source ./Formula/vibestats.rb
vibestats help
brew uninstall vibestats

# Tauri (dev build — opens the app)
npm run tauri:dev

# Tauri (release build — produces DMG in src-tauri/target/release/bundle/)
npm run tauri:build
```

## What goes where

| File / dir | Purpose |
| --- | --- |
| `package.json` | npm metadata + bin entry + release scripts |
| `bin/cli.js` | CLI entry point (subcommands: init, snapshot, build, open, serve, fetch-web, all) |
| `scripts/lib/paths.js` | Resolves `DATA_ROOT` (`$VIBESTATS_DATA_DIR` → repo → `~/.vibestats`) |
| `scripts/release-{prep,bump}.mjs` | Hatchkit-style release pipeline |
| `scripts/build-icons.mjs` | Regenerate platform icon set from `icons/icon.svg` |
| `scripts/*.{js,sh}` | Snapshot + build logic |
| `icons/` | Source SVG + generated PNG/ICO/ICNS at every size |
| `src-tauri/` | Tauri 2 desktop app (Rust). Bundles `bin/` + `scripts/` as resources at build time. |
| `Formula/vibestats.rb` | Homebrew formula (copy into your tap repo) |
| `.github/workflows/release.yml` | Cross-platform Tauri build + npm publish on tag push |
| `pricing.example.json`, `project-aliases.example.json` | Seeded into the user's data dir on first run |
