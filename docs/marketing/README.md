# Marketing assets

Screenshots and GitHub social preview cards for vibestats. Every image shows **fictional data**: the projects, paths and numbers come from a seeded generator, [`scripts/marketing/demo-history.mjs`](../../scripts/marketing/demo-history.mjs). No image was made from anyone's real usage.

[`manifest.json`](manifest.json) lists every file with its size in pixels and bytes, its SHA-256 and its source.

The public demo on the site, [`site/public/demo/index.html`](../../site/public/demo/index.html), uses the same history. `pnpm demo:build` rebuilds it with [`scripts/marketing/build-demo.mjs`](../../scripts/marketing/build-demo.mjs). That page sets `summary.demo` in its data, so its header says "fictional demo data" and shows no "N days old" badge. Its Month and Year ranges start from the snapshot day, 31 October 2026.

## Files

| File | Purpose | Pixels | Made |
| --- | --- | --- | --- |
| `screenshots/dashboard-overview.webp` | README hero, dark theme. Combined dashboard, top of the page: stat cards and the heatmap. | 2560×1800 | 2026-11-07 |
| `screenshots/dashboard-overview-light.webp` | README hero, light theme. Same view. | 2560×1800 | 2026-11-07 |
| `screenshots/day-breakdown.webp` | README features, dark theme. The per-day dialog for 28 October, opened by clicking a heatmap cell. | 2560×1800 | 2026-11-07 |
| `screenshots/day-breakdown-light.webp` | README features, light theme. Same view. | 2560×1800 | 2026-11-07 |
| `screenshots/models-and-projects.webp` | README features, dark theme. Models table and top projects table. | 2560×1800 | 2026-11-07 |
| `screenshots/models-and-projects-light.webp` | README features, light theme. Same view. | 2560×1800 | 2026-11-07 |
| `screenshots/activity-heatmap.webp` | The heatmap card alone, dark theme. Used by the social cards. | 2432×542 | 2026-11-07 |
| `screenshots/activity-heatmap-light.webp` | The heatmap card alone, light theme. Not used by a card yet. | 2432×542 | 2026-11-07 |
| `social-preview/social-preview-a.png` | GitHub social preview, option A: wordmark and tagline left, dashboard bleeding off the right edge. | 1280×640 | 2026-11-07 |
| `social-preview/social-preview-b.png` | Option B: large centred wordmark, tagline, supported tools, heatmap ribbon. | 1280×640 | 2026-11-07 |
| `social-preview/social-preview-c.png` | Option C: light background, heatmap card on top, wordmark and tagline below. | 1280×640 | 2026-11-07 |
| `social-preview/template.html` | Source of all three cards. `?v=a`, `?v=b` or `?v=c` picks the variant. | 1280×640 | 2026-11-06 |
| `social-preview/og-wordmark.png` | og:image. Option B laid out at 1.91:1: its background runs 16 px further at the top and bottom, every margin stays. | 1200×630 | 2026-11-11 |
| `social-preview/og-clean.png` | og:image without text. The stat cards and heatmap from `dashboard-overview.webp`, framed on option B's background. | 1200×630 | 2026-11-11 |
| `social-preview/og-clean.html` | Source of `og-clean.png`. | 1280×672 | 2026-11-11 |
| `social-preview/fonts/` | Inter (Regular, SemiBold) and JetBrains Mono, unmodified, under the SIL Open Font License ([OFL.txt](social-preview/fonts/OFL.txt)). | — | — |

The README shows the light or dark screenshot to match the reader's GitHub theme. It uses a `<picture>` element with `prefers-color-scheme` sources; the dark shot is the fallback where `<picture>` is not supported.

The site's link preview, `site/app/opengraph-image.jpg` (and the identical `twitter-image.jpg`, each with an `.alt.txt`), is `og-wordmark.png` as JPEG:

```bash
magick docs/marketing/social-preview/og-wordmark.png -strip -interlace Plane -sampling-factor 4:4:4 -quality 88 site/app/opengraph-image.jpg && cp site/app/opengraph-image.jpg site/app/twitter-image.jpg
```

GitHub takes the social preview under Settings → General → Social preview. The cards were re-rendered on 2026-11-07 because the dark heatmap's two lowest levels got brighter; a card uploaded before then shows the older colours.

## How they are made

```bash
pnpm marketing:capture                 # screenshots, then social cards, then manifest.json
pnpm marketing:capture shots           # screenshots only
pnpm marketing:capture social          # social cards only (reuses the screenshots)
pnpm marketing:capture og              # og:image cards only
```

[`scripts/marketing/capture.mjs`](../../scripts/marketing/capture.mjs) does this:

1. Writes the fictional history into a new temp directory: Claude Code, Codex and Gemini CLI transcripts for 5 January to 31 October 2026, with a two-week break in August.
2. Runs `scripts/build-all.sh` on it with `VIBESTATS_DATA_DIR` set to that directory and `HOME=/home/demo`. Your own `~/.claude`, `~/.codex`, `~/.gemini` and `~/.vibestats` are not read.
3. Opens `combined-dashboard.html` in headless Chromium at 1280×900 (the desktop app's window size), scale 2, with the clock set to the snapshot day. It does this twice: once with the system colour scheme set to dark, once set to light. Light shots get a `-light` suffix, and `manifest.json` records the theme of each screenshot. Saves WebP at quality 90 with `cwebp`.
4. Renders `social-preview/template.html` at 1280×640 for each variant.
5. Renders the two og:image cards at 1280×672 (the same 1.905:1 shape as 1200×630), scale 2, and downscales them to exactly 1200×630 with ImageMagick.

It needs Playwright, which is not a dependency of this repo. Install it globally (`npm i -g playwright && npx playwright install chromium`), set `NODE_PATH` to a `node_modules` that has `playwright` or `playwright-core`, or set `PLAYWRIGHT_MODULE` to the package directory. If Playwright's own Chromium build is missing, the script uses `CHROMIUM_PATH` when set, and otherwise an installed Google Chrome in headless mode. `cwebp` comes from the `webp` package (`brew install webp`), `magick` from ImageMagick (`brew install imagemagick`).

The same data with the same seed gives the same images. Changes to the dashboard template show up in the next capture.
