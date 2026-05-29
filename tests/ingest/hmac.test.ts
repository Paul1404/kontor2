import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "~/server/crypto/hmac";

const SECRET = "super-secret-key-of-sufficient-length";

describe("verifySignature", () => {
  const body = '{"hello":"world"}';
  const now = 1_700_000_000;

  it("accepts a fresh, correctly-signed payload", () => {
    const sig = signPayload(SECRET, now, body);
    const v = verifySignature({
      secret: SECRET,
      timestampHeader: String(now),
      signatureHeader: sig,
      rawBody: body,
      nowSeconds: now,
    });
    expect(v.ok).toBe(true);
  });

  it("rejects stale timestamps", () => {
    const sig = signPayload(SECRET, now, body);
    const v = verifySignature({
      secret: SECRET,
      timestampHeader: String(now),
      signatureHeader: sig,
      rawBody: body,
      nowSeconds: now + 10 * 60,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("stale_timestamp");
  });

  it("rejects bad signature", () => {
    const sig = signPayload(SECRET, now, body);
    const v = verifySignature({
      secret: SECRET,
      timestampHeader: String(now),
      signatureHeader: `${sig.slice(0, -2)}00`,
      rawBody: body,
      nowSeconds: now,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects tampered body", () => {
    const sig = signPayload(SECRET, now, body);
    const v = verifySignature({
      secret: SECRET,
      timestampHeader: String(now),
      signatureHeader: sig,
      rawBody: body.replace("world", "evil"),
      nowSeconds: now,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects missing headers", () => {
    const v = verifySignature({
      secret: SECRET,
      timestampHeader: null,
      signatureHeader: null,
      rawBody: body,
      nowSeconds: now,
    });
    expect(v.ok).toBe(false);
  });
});
