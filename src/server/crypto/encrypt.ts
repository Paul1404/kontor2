import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "~/server/env";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const VERSION = 1;

function key(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, "hex");
}

export function encryptString(plain: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]);
}

export function decryptToString(blob: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const version = buf[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext version ${version}`);
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const enc = buf.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function safeDecrypt(blob: Buffer | Uint8Array | null | undefined): string | null {
  if (!blob) return null;
  try {
    return decryptToString(blob);
  } catch {
    return null;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function lastFour(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = value.replace(/\s+/g, "");
  return clean.length >= 4 ? clean.slice(-4) : clean;
}
