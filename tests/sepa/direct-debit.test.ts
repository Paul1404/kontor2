import { describe, expect, it } from "vitest";
import { paysByDirectDebit } from "~/server/sepa/direct-debit";

describe("paysByDirectDebit", () => {
  it("treats a blank lastschrift as direct debit (Linear's default)", () => {
    expect(paysByDirectDebit(null, null)).toBe(true);
    expect(paysByDirectDebit("", null)).toBe(true);
    expect(paysByDirectDebit("   ", null)).toBe(true);
    expect(paysByDirectDebit(undefined, undefined)).toBe(true);
  });

  it("treats lastschrift = 'J' (any case) as direct debit", () => {
    expect(paysByDirectDebit("J", null)).toBe(true);
    expect(paysByDirectDebit("j", null)).toBe(true);
    expect(paysByDirectDebit(" J ", null)).toBe(true);
  });

  it("excludes an explicit non-J lastschrift", () => {
    expect(paysByDirectDebit("N", null)).toBe(false);
    expect(paysByDirectDebit("n", null)).toBe(false);
    expect(paysByDirectDebit("X", null)).toBe(false);
  });

  it("excludes invoice payers (aufRechnung = 'J') regardless of lastschrift", () => {
    expect(paysByDirectDebit(null, "J")).toBe(false);
    expect(paysByDirectDebit("J", "J")).toBe(false);
    expect(paysByDirectDebit("J", "j")).toBe(false);
    expect(paysByDirectDebit("", " J ")).toBe(false);
  });

  it("includes when aufRechnung is set to a non-J value", () => {
    expect(paysByDirectDebit(null, "N")).toBe(true);
    expect(paysByDirectDebit("J", "")).toBe(true);
  });
});
