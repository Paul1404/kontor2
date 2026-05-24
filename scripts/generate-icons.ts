#!/usr/bin/env bun
/**
 * Generates the full favicon set from `public/favicon.svg` via sharp.
 *
 * Run with: bun run icons:generate
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "public");
const SOURCE = join(PUBLIC, "favicon.svg");

const targets: Array<{ name: string; size: number }> = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

async function main(): Promise<void> {
  const svg = await readFile(SOURCE);
  await mkdir(dirname(SOURCE), { recursive: true });
  for (const t of targets) {
    const out = join(PUBLIC, t.name);
    await sharp(svg, { density: 384 }).resize(t.size, t.size).png().toFile(out);
    console.log(`wrote ${out}`);
  }
  // .ico (16/32/48 multi-resolution). sharp doesn't write ICO directly, so we
  // bake a 32x32 PNG-in-ICO container by hand (sufficient for all modern UAs).
  const png32 = await sharp(svg, { density: 384 }).resize(32, 32).png().toBuffer();
  const ico = makeIco(png32, 32);
  await writeFile(join(PUBLIC, "favicon.ico"), ico);
  console.log(`wrote ${join(PUBLIC, "favicon.ico")}`);
}

function makeIco(pngBuf: Buffer, size: number): Buffer {
  const ICONDIR = Buffer.alloc(6);
  ICONDIR.writeUInt16LE(0, 0); // reserved
  ICONDIR.writeUInt16LE(1, 2); // type: ICO
  ICONDIR.writeUInt16LE(1, 4); // count
  const ICONDIRENTRY = Buffer.alloc(16);
  ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 0); // width
  ICONDIRENTRY.writeUInt8(size === 256 ? 0 : size, 1); // height
  ICONDIRENTRY.writeUInt8(0, 2); // palette
  ICONDIRENTRY.writeUInt8(0, 3); // reserved
  ICONDIRENTRY.writeUInt16LE(1, 4); // color planes
  ICONDIRENTRY.writeUInt16LE(32, 6); // bpp
  ICONDIRENTRY.writeUInt32LE(pngBuf.length, 8); // size
  ICONDIRENTRY.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([ICONDIR, ICONDIRENTRY, pngBuf]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
