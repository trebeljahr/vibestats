#!/usr/bin/env node
/*
 * build-icons — convert src-tauri/icons/icon.svg into every platform-specific
 * icon format Tauri's proc-macro generate_context!() needs at compile time:
 *
 *   src-tauri/icons/icon.png            (1024×1024 master)
 *   src-tauri/icons/32x32.png, 128x128.png, 128x128@2x.png  (Tauri Linux/Win)
 *   src-tauri/icons/icon.ico            (Windows)
 *   src-tauri/icons/icon.icns           (macOS — iconutil on darwin,
 *                                        png2icns from icnsutils on Linux)
 *   src-tauri/icons/Square*x*.png       (broader Tauri set)
 *
 * Output lands directly under src-tauri/ because tauri.conf.json's bundle.icon
 * paths resolve relative to that directory; same for trayIcon.iconPath and the
 * include_bytes!("../icons/32x32.png") in src/lib.rs. Only icon.svg is tracked
 * in git — generated artifacts are .gitignored and rebuilt locally (`npm run
 * icons`) and in CI (.github/workflows/ci.yml installs the deps).
 *
 * Requires `rsvg-convert` (brew install librsvg / apt install librsvg2-bin)
 * and `magick` for ICO (brew install imagemagick / apt install imagemagick).
 * ICNS on darwin uses iconutil; on Linux uses png2icns (apt install icnsutils).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const iconsDir = join(repoRoot, "src-tauri", "icons");
const src = join(iconsDir, "icon.svg");

if (!existsSync(src)) {
  console.error(`build-icons: missing ${src}`);
  process.exit(1);
}

function need(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; }
  catch { return false; }
}

if (!need("rsvg-convert")) {
  console.error("build-icons: rsvg-convert not found. brew install librsvg.");
  process.exit(1);
}

function svgToPng(size, outName) {
  const out = join(iconsDir, outName);
  execSync(`rsvg-convert -w ${size} -h ${size} "${src}" -o "${out}"`);
  console.log(`  wrote ${outName} (${size}×${size})`);
}

// Master + Tauri's required sizes
svgToPng(1024, "icon.png");
svgToPng(32, "32x32.png");
svgToPng(128, "128x128.png");
svgToPng(256, "128x128@2x.png");
svgToPng(30, "Square30x30Logo.png");
svgToPng(44, "Square44x44Logo.png");
svgToPng(71, "Square71x71Logo.png");
svgToPng(89, "Square89x89Logo.png");
svgToPng(107, "Square107x107Logo.png");
svgToPng(142, "Square142x142Logo.png");
svgToPng(150, "Square150x150Logo.png");
svgToPng(284, "Square284x284Logo.png");
svgToPng(310, "Square310x310Logo.png");
svgToPng(50, "StoreLogo.png");

// Windows ICO
if (need("magick")) {
  const ico = join(iconsDir, "icon.ico");
  execSync(`magick "${join(iconsDir, "icon.png")}" -define icon:auto-resize=256,128,64,48,32,16 "${ico}"`);
  console.log(`  wrote icon.ico`);
} else {
  console.warn("  (skip) magick not found — icon.ico not generated. brew install imagemagick.");
}

// ICNS — required at compile time by Tauri's generate_context!() proc-macro
// because tauri.conf.json's bundle.icon array lists icon.icns. macOS uses the
// system `iconutil` (best quality, all subtypes). Linux falls back to
// `png2icns` from icnsutils so the Ubuntu cargo-check job in CI doesn't bail.
const icns = join(iconsDir, "icon.icns");
if (process.platform === "darwin") {
  const tmp = join(iconsDir, "icon.iconset");
  if (existsSync(tmp)) rmSync(tmp, { recursive: true });
  mkdirSync(tmp);
  const isetSizes = [
    [16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"],
    [128, "128x128"], [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"],
    [512, "512x512"], [1024, "512x512@2x"],
  ];
  for (const [size, name] of isetSizes) {
    execSync(`rsvg-convert -w ${size} -h ${size} "${src}" -o "${join(tmp, `icon_${name}.png`)}"`);
  }
  execSync(`iconutil -c icns "${tmp}" -o "${icns}"`);
  rmSync(tmp, { recursive: true });
  console.log(`  wrote icon.icns (iconutil)`);
} else if (need("png2icns")) {
  // png2icns takes a list of square PNGs at supported ICNS sizes and packs
  // them. Sizes 16/32/48/128/256/512 cover the modern macOS subtypes.
  const sizes = [16, 32, 48, 128, 256, 512];
  const tmp = join(iconsDir, "icon.iconset");
  if (existsSync(tmp)) rmSync(tmp, { recursive: true });
  mkdirSync(tmp);
  const pngs = sizes.map(s => {
    const p = join(tmp, `${s}.png`);
    execSync(`rsvg-convert -w ${s} -h ${s} "${src}" -o "${p}"`);
    return p;
  });
  execSync(`png2icns "${icns}" ${pngs.map(p => `"${p}"`).join(" ")}`);
  rmSync(tmp, { recursive: true });
  console.log(`  wrote icon.icns (png2icns)`);
} else {
  console.warn("  (skip) icon.icns — install iconutil (macOS) or icnsutils (Linux: apt install icnsutils).");
}

console.log("Done.");
