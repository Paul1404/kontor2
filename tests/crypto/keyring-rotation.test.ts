import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptWithRing,
  encryptWithRing,
  type Keyring,
  makeKeyringEntry,
} from "~/server/crypto/encrypt";

/**
 * Proves the rotation MECHANISM is lossless at the crypto layer, independent of
 * the database. A v2 ciphertext carries a 4-byte key fingerprint, so a keyring
 * holding both the new (current) and old (previous) key can still read old data
 * while writing new. The DB-level proof that `reencryptAllData` applies this to
 * every registered column lives in the integration test; the coverage test
 * proves the column list is complete.
 */
function ring(current: Buffer, previous: Buffer[] = []): Keyring {
  return {
    current: makeKeyringEntry("current", current),
    previous: previous.map((k, i) => makeKeyringEntry(`prev-${i}`, k)),
  };
}

describe("keyring rotation is lossless", () => {
  it("reads old data, rewrites it onto the new key, survives dropping the old key", () => {
    const keyA = randomBytes(32);
    const keyB = randomBytes(32);
    const secret = "DE89370400440532013000";

    // Written under key A alone.
    const blobA = encryptWithRing(ring(keyA), secret);

    // Rotation window: B is current, A kept as previous. Old data still reads.
    const rotating = ring(keyB, [keyA]);
    expect(decryptWithRing(rotating, blobA)).toBe(secret);

    // Re-encrypt onto the current key (what reencryptAllData does per row).
    const blobB = encryptWithRing(rotating, decryptWithRing(rotating, blobA));

    // Old key dropped: B alone. The rewritten blob is still readable...
    const finalRing = ring(keyB);
    expect(decryptWithRing(finalRing, blobB)).toBe(secret);

    // ...but the un-rewritten blob is NOT. This is exactly why the old key may
    // only be dropped after a full re-encrypt pass (assessKeyDropSafety gate).
    expect(() => decryptWithRing(finalRing, blobA)).toThrow(/No key for fingerprint/);
  });

  it("round-trips an empty string (used for cleared secret fields)", () => {
    const key = randomBytes(32);
    const blob = encryptWithRing(ring(key), "");
    expect(decryptWithRing(ring(key), blob)).toBe("");
  });

  it("gives distinct keys distinct fingerprints", () => {
    const a = makeKeyringEntry("a", randomBytes(32));
    const b = makeKeyringEntry("b", randomBytes(32));
    expect(a.fingerprint.equals(b.fingerprint)).toBe(false);
  });
});
