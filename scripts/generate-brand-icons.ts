#!/usr/bin/env bun
/**
 * Rendert den vollständigen Raster-Icon-Satz der App aus der Kontor²-Markenmarke
 * (`Kontor2-Brand/`, dem Markenstamm). Quelle ist das **PNG** `app-icon-1024.png`,
 * weil die Marken-SVGs den Spectral-Webfont referenzieren, den sharp ohne Browser
 * nicht laden kann (er würde auf Georgia ausweichen). Im PNG ist Spectral gebacken,
 * also pixelgetreu zur Marke.
 *
 * Zusätzlich werden die scalierbaren Vektoren (`symbol.svg`) als `public/logo.svg`
 * und `public/favicon.svg` übernommen. In der App ist Spectral als Webfont geladen,
 * dort rendert das SVG echtes Spectral; im Browser-Chrome (Favicon) ohne den
 * Seiten-Font fällt es auf Georgia/Serif zurück (bei 16 px vernachlässigbar).
 *
 * Outputs (überschreibt die alten Defaults):
 *   public/logo.png  (1024, UI-Fallback + PDF-Logo)
 *   public/logo.svg · public/favicon.svg  (Vektor)
 *   public/favicon-{16,32}.png · favicon.ico (32) · apple-touch-icon.png (180)
 *   public/icon-{192,512}.png
 *
 * Lauf: `bun run icons:brand`. Braucht sharp (Dev-Abhängigkeit).
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(new URL("..", import.meta.url).pathname);
const PUBLIC = join(ROOT, "public");
const BRAND = join(ROOT, "Kontor2-Brand");
const MASTER_SIZE = 1024;

const variants: Array<{ name: string; size: number }> = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

/** Minimaler ICO-Container um ein einzelnes PNG. */
function makeIco(pngBuf: Buffer, size: number): Buffer {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([dir, entry, pngBuf]);
}

async function main(): Promise<void> {
  // Vektoren übernehmen (scharf in der App, wo Spectral geladen ist).
  await copyFile(join(BRAND, "svg/symbol.svg"), join(PUBLIC, "logo.svg"));
  await copyFile(join(BRAND, "svg/symbol.svg"), join(PUBLIC, "favicon.svg"));
  console.log("copied public/logo.svg + favicon.svg (brand symbol)");

  // Raster aus dem Spectral-gebackenen Master.
  const src = await readFile(join(BRAND, "png/app-icon-1024.png"));
  const master = await sharp(src).resize(MASTER_SIZE, MASTER_SIZE).png().toBuffer();
  await writeFile(join(PUBLIC, "logo.png"), master);
  console.log("wrote public/logo.png");

  for (const v of variants) {
    await sharp(master).resize(v.size, v.size).png().toFile(join(PUBLIC, v.name));
    console.log(`wrote public/${v.name}`);
  }

  const png32 = await sharp(master).resize(32, 32).png().toBuffer();
  await writeFile(join(PUBLIC, "favicon.ico"), makeIco(png32, 32));
  console.log("wrote public/favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
