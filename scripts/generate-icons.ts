#!/usr/bin/env bun
/**
 * Generates the full favicon and app-icon set from the SV Untereuerheim
 * crest PNG (`public/logo-source-raw.png`). The source is non-square, so we
 * pad it on a white square background to produce the icon variants the web
 * platform expects.
 *
 * Outputs:
 *   - public/logo.png            (square 1024 master, used in UI)
 *   - public/favicon-{16,32}.png
 *   - public/favicon.ico         (32x32 PNG-in-ICO)
 *   - public/apple-touch-icon.png (180x180)
 *   - public/icon-{192,512}.png
 *   - public/favicon.svg         (SVG wrapper embedding the master PNG)
 *
 * Run with: bun run icons:generate
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "public");
const SOURCE = join(PUBLIC, "logo-source-raw.png");

const PADDED_MASTER = 1024;
const PAD_RATIO = 0.08; // 8% padding around the crest on each side

async function buildSquareMaster(): Promise<Buffer> {
  const src = await readFile(SOURCE);
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const longest = Math.max(w, h);
  const inner = Math.round(PADDED_MASTER * (1 - PAD_RATIO * 2));
  const scale = inner / longest;
  const resizedW = Math.round(w * scale);
  const resizedH = Math.round(h * scale);
  const resized = await sharp(src).resize(resizedW, resizedH, { fit: "contain" }).png().toBuffer();
  return sharp({
    create: {
      width: PADDED_MASTER,
      height: PADDED_MASTER,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();
}

const variants: Array<{ name: string; size: number }> = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

async function main(): Promise<void> {
  const master = await buildSquareMaster();
  await writeFile(join(PUBLIC, "logo.png"), master);
  console.log(`wrote ${join(PUBLIC, "logo.png")}`);

  for (const v of variants) {
    const out = join(PUBLIC, v.name);
    await sharp(master).resize(v.size, v.size).png().toFile(out);
    console.log(`wrote ${out}`);
  }

  const png32 = await sharp(master).resize(32, 32).png().toBuffer();
  await writeFile(join(PUBLIC, "favicon.ico"), makeIco(png32, 32));
  console.log(`wrote ${join(PUBLIC, "favicon.ico")}`);

  // Embed the 512px PNG inside a tiny SVG so the SVG favicon link still works.
  const png512 = await sharp(master).resize(512, 512).png().toBuffer();
  const dataUri = `data:image/png;base64,${png512.toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="SV Untereuerheim"><image href="${dataUri}" width="512" height="512"/></svg>\n`;
  await writeFile(join(PUBLIC, "favicon.svg"), svg);
  console.log(`wrote ${join(PUBLIC, "favicon.svg")}`);
}

function makeIco(pngBuf: Buffer, size: number): Buffer {
  const ICONDIR = Buffer.alloc(6);
  ICONDIR.writeUInt16LE(0, 0);
  ICONDIR.writeUInt16LE(1, 2);
  ICONDIR.writeUInt16LE(1, 4);
  const ICONDIRENTRY = Buffer.alloc(16);
  ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 0);
  ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 1);
  ICONDIRENTRY.writeUInt8(0, 2);
  ICONDIRENTRY.writeUInt8(0, 3);
  ICONDIRENTRY.writeUInt16LE(1, 4);
  ICONDIRENTRY.writeUInt16LE(32, 6);
  ICONDIRENTRY.writeUInt32LE(pngBuf.length, 8);
  ICONDIRENTRY.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([ICONDIR, ICONDIRENTRY, pngBuf]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
