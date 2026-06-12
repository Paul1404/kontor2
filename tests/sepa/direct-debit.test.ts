import { describe, expect, it } from "vitest";
import { paysByDirectDebit } from "~/server/sepa/direct-debit";

describe("paysByDirectDebit", () => {
  it("treats a blank lastschrift as direct debit (Linear's default)", () => {
    expect(paysByDirectDebit(null, null)).toBe(true);
    expect(paysByDirectDebit("", null)).toBe(true);
    expect(paysByDirectDebit("   ", null)).toBe(true);
    expect(paysByDirectDebit(undefined, undefined)).toBe(true);
  });

  it("treats Linear's Lastschrift codes ('J', 'L', 'B', any case) as direct debit", () => {
    expect(paysByDirectDebit("J", null)).toBe(true);
    expect(paysByDirectDebit("j", null)).toBe(true);
    expect(paysByDirectDebit("L", null)).toBe(true);
    expect(paysByDirectDebit("l", null)).toBe(true);
    expect(paysByDirectDebit("B", null)).toBe(true);
    expect(paysByDirectDebit(" L ", null)).toBe(true);
  });

  it("ignores the lastschrift value: only aufRechnung decides", () => {
    // lastschrift never marks an invoice payer; Linear used it for direct-debit
    // variants, not for invoicing.
    expect(paysByDirectDebit("N", null)).toBe(true);
    expect(paysByDirectDebit("X", null)).toBe(true);
  });

  it("excludes invoice payers (aufRechnung = 'J') regardless of lastschrift", () => {
    expect(paysByDirectDebit(null, "J")).toBe(false);
    expect(paysByDirectDebit("J", "J")).toBe(false);
    expect(paysByDirectDebit("L", "j")).toBe(false);
    expect(paysByDirectDebit("", " J ")).toBe(false);
  });

  it("includes when aufRechnung is set to a non-J value", () => {
    expect(paysByDirectDebit(null, "N")).toBe(true);
    expect(paysByDirectDebit("J", "")).toBe(true);
  });
});
