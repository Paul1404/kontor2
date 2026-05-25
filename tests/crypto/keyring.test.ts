import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptWithRing,
  encryptWithRing,
  inspectCiphertext,
  type Keyring,
  keyFingerprint,
  makeKeyringEntry,
} from "~/server/crypto/encrypt";

function makeKey(): Buffer {
  return randomBytes(32);
}

function ringWith(currentHex: string, ...previousHex: string[]): Keyring {
  return {
    current: makeKeyringEntry("current", Buffer.from(currentHex, "hex")),
    previous: previousHex.map((h, i) => makeKeyringEntry(`prev-${i}`, Buffer.from(h, "hex"))),
  };
}

describe("keyFingerprint", () => {
  it("is 4 bytes", () => {
    expect(keyFingerprint(makeKey())).toHaveLength(4);
  });
  it("is deterministic", () => {
    const k = makeKey();
    expect(keyFingerprint(k).equals(keyFingerprint(k))).toBe(true);
  });
  it("differs for different keys", () => {
    expect(keyFingerprint(makeKey()).equals(keyFingerprint(makeKey()))).toBe(false);
  });
});

describe("encrypt/decrypt round trip", () => {
  it("decrypts what it just encrypted", () => {
    const ring = ringWith(makeKey().toString("hex"));
    const blob = encryptWithRing(ring, "DE89370400440532013000");
    expect(decryptWithRing(ring, blob)).toBe("DE89370400440532013000");
  });

  it("produces a v2 ciphertext with the current key's fingerprint", () => {
    const ring = ringWith(makeKey().toString("hex"));
    const blob = encryptWithRing(ring, "hello");
    const info = inspectCiphertext(blob);
    expect(info?.version).toBe(2);
    if (info?.version === 2) {
      expect(info.fingerprint.equals(ring.current.fingerprint)).toBe(true);
    }
  });

  it("decrypts a ciphertext written with a previous key", () => {
    const oldHex = makeKey().toString("hex");
    const newHex = makeKey().toString("hex");
    const oldRing = ringWith(oldHex);
    const blob = encryptWithRing(oldRing, "secret");

    // Now the active key changes, old one moves to `previous`.
    const rotatedRing = ringWith(newHex, oldHex);
    expect(decryptWithRing(rotatedRing, blob)).toBe("secret");
  });

  it("fails decryption when neither current nor previous matches", () => {
    const oldRing = ringWith(makeKey().toString("hex"));
    const blob = encryptWithRing(oldRing, "secret");
    const unrelated = ringWith(makeKey().toString("hex"));
    expect(() => decryptWithRing(unrelated, blob)).toThrow(/No key for fingerprint/);
  });
});

describe("v1 legacy ciphertext compatibility", () => {
  function makeV1Blob(plain: string, key: Buffer): Buffer {
    // Hand-roll a v1 ciphertext to verify backward compatibility.
    const { createCipheriv, randomBytes: rb } = require("node:crypto");
    const iv = rb(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([1]), iv, tag, enc]);
  }

  it("reads a v1 ciphertext using the current key", () => {
    const keyHex = makeKey().toString("hex");
    const ring = ringWith(keyHex);
    const v1 = makeV1Blob("legacy", Buffer.from(keyHex, "hex"));
    expect(decryptWithRing(ring, v1)).toBe("legacy");
  });

  it("reads a v1 ciphertext using a previous key when current doesn't match", () => {
    const oldHex = makeKey().toString("hex");
    const newHex = makeKey().toString("hex");
    const v1 = makeV1Blob("ancient", Buffer.from(oldHex, "hex"));
    const ring = ringWith(newHex, oldHex);
    expect(decryptWithRing(ring, v1)).toBe("ancient");
  });

  it("inspects v1 as { version: 1 } with no fingerprint", () => {
    const v1 = makeV1Blob("x", makeKey());
    const info = inspectCiphertext(v1);
    expect(info?.version).toBe(1);
  });
});

describe("inspectCiphertext", () => {
  it("returns null for empty buffers", () => {
    expect(inspectCiphertext(Buffer.alloc(0))).toBe(null);
  });
  it("returns null for unknown version bytes", () => {
    expect(inspectCiphertext(Buffer.from([99, 0, 0]))).toBe(null);
  });
});
