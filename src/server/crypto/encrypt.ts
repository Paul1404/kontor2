import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { activeKeyring } from "~/server/crypto/active-keyring";
import { env } from "~/server/env";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const FP_LEN = 4;

/** Single-key format. Predates the keyring; only readable with the active key. */
const VERSION_V1 = 1;
/** Keyring format. `[VERSION=2][KEY_FP(4)][IV(12)][TAG(16)][CT]`. */
const VERSION_V2 = 2;

let decryptFailures = 0;

export type KeyringEntry = { id: string; key: Buffer; fingerprint: Buffer };

export type Keyring = {
  current: KeyringEntry;
  previous: KeyringEntry[];
};

/** 4-byte fingerprint, `sha256(key).slice(0, 4)`. Collision risk ≈ 2^-32. */
export function keyFingerprint(key: Buffer): Buffer {
  return createHash("sha256").update(key).digest().subarray(0, FP_LEN);
}

export function makeKeyringEntry(id: string, key: Buffer): KeyringEntry {
  return { id, key, fingerprint: keyFingerprint(key) };
}

/**
 * Der für die aktuelle Operation gültige Keyring: der per AsyncLocalStorage
 * gesetzte Per-Verein-Keyring, sonst der primäre `env().encryptionKeyring`.
 */
function keyring(): Keyring {
  return activeKeyring() ?? env().encryptionKeyring;
}

function findKey(ring: Keyring, fp: Buffer): KeyringEntry | null {
  if (fp.equals(ring.current.fingerprint)) return ring.current;
  for (const k of ring.previous) {
    if (fp.equals(k.fingerprint)) return k;
  }
  return null;
}

export function encryptString(plain: string): Buffer {
  return encryptWithRing(keyring(), plain);
}

export function encryptWithRing(ring: Keyring, plain: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, ring.current.key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION_V2]), ring.current.fingerprint, iv, tag, enc]);
}

export function decryptToString(blob: Buffer | Uint8Array): string {
  return decryptWithRing(keyring(), blob);
}

export function decryptWithRing(ring: Keyring, blob: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length === 0) throw new Error("Empty ciphertext");
  const version = buf[0];
  if (version === VERSION_V2) {
    if (buf.length < 1 + FP_LEN + IV_LEN + TAG_LEN) {
      throw new Error("Truncated v2 ciphertext");
    }
    const fp = buf.subarray(1, 1 + FP_LEN);
    const entry = findKey(ring, fp);
    if (!entry) {
      throw new Error(`No key for fingerprint ${fp.toString("hex")}`);
    }
    const iv = buf.subarray(1 + FP_LEN, 1 + FP_LEN + IV_LEN);
    const tag = buf.subarray(1 + FP_LEN + IV_LEN, 1 + FP_LEN + IV_LEN + TAG_LEN);
    const enc = buf.subarray(1 + FP_LEN + IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, entry.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }
  if (version === VERSION_V1) {
    if (buf.length < 1 + IV_LEN + TAG_LEN) {
      throw new Error("Truncated v1 ciphertext");
    }
    const iv = buf.subarray(1, 1 + IV_LEN);
    const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
    const enc = buf.subarray(1 + IV_LEN + TAG_LEN);
    // v1 has no key id, so try every key in the ring until one authenticates.
    for (const entry of [ring.current, ...ring.previous]) {
      try {
        const decipher = createDecipheriv(ALG, entry.key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
      } catch {
        // wrong key, try next
      }
    }
    throw new Error("No key in keyring matches v1 ciphertext");
  }
  throw new Error(`Unsupported ciphertext version ${version}`);
}

/**
 * Returns the version + key fingerprint that produced a ciphertext, without
 * decrypting. v1 has no fingerprint (returns `null`). Used by the re-encrypt
 * job to skip rows that are already on the current key.
 */
export function inspectCiphertext(
  blob: Buffer | Uint8Array,
): { version: 1 } | { version: 2; fingerprint: Buffer } | null {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length === 0) return null;
  const v = buf[0];
  if (v === VERSION_V1) return { version: 1 };
  if (v === VERSION_V2 && buf.length >= 1 + FP_LEN) {
    return { version: 2, fingerprint: buf.subarray(1, 1 + FP_LEN) };
  }
  return null;
}

export function safeDecrypt(blob: Buffer | Uint8Array | null | undefined): string | null {
  if (!blob) return null;
  try {
    return decryptToString(blob);
  } catch (err) {
    decryptFailures += 1;
    // Loud on the first few, then back off — a misconfigured keyring would
    // otherwise spam stderr once per row.
    if (decryptFailures <= 5 || decryptFailures % 100 === 0) {
      console.error(
        `[crypto] decrypt failed (#${decryptFailures}): ${(err as Error).message}. ` +
          `Check APP_SECRET / APP_SECRET_PREV.`,
      );
    }
    return null;
  }
}

export function getDecryptFailureCount(): number {
  return decryptFailures;
}

/** Test-only; used by the encrypt round-trip tests to keep runs independent. */
export function _resetDecryptFailureCount(): void {
  decryptFailures = 0;
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
