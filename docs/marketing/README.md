# Marketing assets

Screenshots and GitHub social preview cards for vibestats. Every image shows **fictional data**: the projects, paths and numbers come from a seeded generator, [`scripts/marketing/demo-history.mjs`](../../scripts/marketing/demo-history.mjs). No image was made from anyone's real usage.

[`manifest.json`](manifest.json) lists every file with its size in pixels and bytes, its SHA-256 and its source.

## Files

| File | Purpose | Pixels | Made |
| --- | --- | --- | --- |
| `screenshots/dashboard-overview.webp` | README hero. Combined dashboard, top of the page: stat cards and the heatmap. | 2560×1800 | 2026-11-06 |
| `screenshots/day-breakdown.webp` | README features. The per-day dialog for 28 October, opened by clicking a heatmap cell. | 2560×1800 | 2026-11-06 |
| `screenshots/models-and-projects.webp` | README features. Models table and top projects table. | 2560×1800 | 2026-11-06 |
| `screenshots/activity-heatmap.webp` | The heatmap card alone. Used by the social cards. | 2432×542 | 2026-11-06 |
| `social-preview/social-preview-a.png` | GitHub social preview, option A: wordmark and tagline left, dashboard bleeding off the right edge. | 1280×640 | 2026-11-06 |
| `social-preview/social-preview-b.png` | Option B: large centred wordmark, tagline, supported tools, heatmap ribbon. | 1280×640 | 2026-11-06 |
| `social-preview/social-preview-c.png` | Option C: light background, heatmap card on top, wordmark and tagline below. | 1280×640 | 2026-11-06 |
| `social-preview/template.html` | Source of all three cards. `?v=a`, `?v=b` or `?v=c` picks the variant. | 1280×640 | 2026-11-06 |
| `social-preview/fonts/` | Inter (Regular, SemiBold) and JetBrains Mono, unmodified, under the SIL Open Font License ([OFL.txt](social-preview/fonts/OFL.txt)). | — | — |

The social preview is not uploaded yet. GitHub takes it under Settings → General → Social preview.

## How they are made

```bash
npm run marketing:capture              # screenshots, then social cards, then manifest.json
npm run marketing:capture -- shots     # screenshots only
npm run marketing:capture -- social    # social cards only (reuses the screenshots)
```

[`scripts/marketing/capture.mjs`](../../scripts/marketing/capture.mjs) does this:

1. Writes the fictional history into a new temp directory: Claude Code, Codex and Gemini CLI transcripts for 5 January to 31 October 2026, with a two-week break in August.
2. Runs `scripts/build-all.sh` on it with `VIBESTATS_DATA_DIR` set to that directory and `HOME=/home/demo`. Your own `~/.claude`, `~/.codex`, `~/.gemini` and `~/.vibestats` are not read.
3. Opens `combined-dashboard.html` in headless Chromium at 1280×900 (the desktop app's window size), scale 2, with the clock set to the snapshot day. Saves WebP at quality 90 with `cwebp`.
4. Renders `social-preview/template.html` at 1280×640 for each variant.

It needs Playwright with Chromium, which is not a dependency of this repo. Either install it globally (`npm i -g playwright && npx playwright install chromium`) or set `NODE_PATH` to a `node_modules` that has `playwright` or `playwright-core` with its matching browser. `cwebp` comes from the `webp` package (`brew install webp`).

The same data with the same seed gives the same images. Changes to the dashboard template show up in the next capture.
