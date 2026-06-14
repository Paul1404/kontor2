#!/usr/bin/env bun
/**
 * Rastert die Kontor2-Markenmarke (`public/logo.svg`, Navy-Squircle mit
 * Messing-Monogramm) in den vollständigen Raster-Icon-Satz. Der vektorbasierte
 * `favicon.svg` bleibt unangetastet (er ist bereits die saubere Vektorquelle).
 *
 * Outputs (überschreibt die alten Wappen-Defaults):
 *   public/logo.png  (1024, UI-Fallback + PDF-Logo)
 *   public/favicon-{16,32}.png · favicon.ico (32) · apple-touch-icon.png (180)
 *   public/icon-{192,512}.png
 *
 * Lauf: `bun run icons:brand`. Braucht sharp (Dev-Abhängigkeit).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const PUBLIC = join(new URL("..", import.meta.url).pathname, "public");
const MASTER = 1024;

const variants: Array<{ name: string; size: number }> = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

/** Minimaler ICO-Container um ein einzelnes PNG (wie in generate-icons.ts). */
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
  const svg = await readFile(join(PUBLIC, "logo.svg"));
  // Hohe Density, damit das 512er-viewBox scharf auf 1024 rastert.
  const master = await sharp(svg, { density: 288 }).resize(MASTER, MASTER).png().toBuffer();
  await writeFile(join(PUBLIC, "logo.png"), master);
  console.log("wrote public/logo.png");

  for (const v of variants) {
    const out = join(PUBLIC, v.name);
    await sharp(master).resize(v.size, v.size).png().toFile(out);
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
