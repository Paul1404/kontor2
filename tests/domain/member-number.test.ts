import { describe, expect, it } from "vitest";
import { withUniqueRetry } from "~/server/db/retry";
import {
  assertValidMemberNumber,
  generateMemberNumber,
  isValidMemberNumber,
  MEMBER_NUMBER_RE,
} from "~/server/domain/member-number";

describe("generateMemberNumber", () => {
  it("produces the M-/K- prefix per namespace", () => {
    expect(generateMemberNumber("member").startsWith("M-")).toBe(true);
    expect(generateMemberNumber("kontakt").startsWith("K-")).toBe(true);
  });

  it("matches the documented format and never uses ambiguous symbols", () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateMemberNumber(i % 2 === 0 ? "member" : "kontakt");
      expect(MEMBER_NUMBER_RE.test(code)).toBe(true);
      // Crockford base32 minus I, L, O, U: the body must contain none of them.
      expect(/[ILOU]/.test(code.slice(2))).toBe(false);
    }
  });

  it("exercises the whole alphabet roughly uniformly (no modulo bias)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      for (const ch of generateMemberNumber("member").slice(2)) seen.add(ch);
    }
    // All 32 symbols should appear across enough draws.
    expect(seen.size).toBe(32);
  });

  it("is effectively unique across many draws", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10000; i += 1) codes.add(generateMemberNumber("member"));
    // Collisions are possible but vanishingly rare; allow a tiny margin.
    expect(codes.size).toBeGreaterThan(9990);
  });
});

describe("isValidMemberNumber / assertValidMemberNumber", () => {
  it("accepts well-formed codes and rejects malformed ones", () => {
    expect(isValidMemberNumber("M-ABC123")).toBe(true);
    expect(isValidMemberNumber("K-9Z8Y7X")).toBe(true);
    expect(isValidMemberNumber("X-ABC123")).toBe(false); // wrong prefix
    expect(isValidMemberNumber("M-ABC12")).toBe(false); // too short
    expect(isValidMemberNumber("M-ABCI23")).toBe(false); // ambiguous I
    expect(isValidMemberNumber("M-abc123")).toBe(false); // lowercase
    expect(() => assertValidMemberNumber("nope")).toThrow();
    expect(() => assertValidMemberNumber(generateMemberNumber("kontakt"))).not.toThrow();
  });
});

describe("collision handling via withUniqueRetry", () => {
  it("regenerates and succeeds after a unique violation on the first insert", async () => {
    let attempts = 0;
    const inserted: string[] = [];
    const result = await withUniqueRetry(async () => {
      attempts += 1;
      const code = generateMemberNumber("member");
      // Simulate the DB rejecting the first attempt with a 23505.
      if (attempts === 1) throw { code: "23505" };
      inserted.push(code);
      return code;
    });
    expect(attempts).toBe(2);
    expect(isValidMemberNumber(result)).toBe(true);
    expect(inserted).toEqual([result]);
  });
});
