import { describe, expect, it } from "vitest";
import { formatIbanGrouped, normalizeIban, validateIban } from "~/server/sepa/iban";

describe("validateIban", () => {
  it("accepts known good German IBANs", () => {
    // Legacy SV Untereuerheim org account from reference/linear/datesicherung.sql
    expect(validateIban("DE56793501010005124185")).toBe(true);
    expect(validateIban("DE56 7935 0101 0005 1241 85")).toBe(true);
    expect(validateIban("DE89370400440532013000")).toBe(true); // Wikipedia example
  });

  it("accepts other SEPA IBANs", () => {
    expect(validateIban("AT611904300234573201")).toBe(true);
    expect(validateIban("FR1420041010050500013M02606")).toBe(true);
    expect(validateIban("NL91ABNA0417164300")).toBe(true);
  });

  it("rejects bad checksum", () => {
    expect(validateIban("DE00000000000000000000")).toBe(false);
    expect(validateIban("DE89370400440532013001")).toBe(false);
  });

  it("rejects wrong length for country", () => {
    expect(validateIban("DE5679350101")).toBe(false);
    expect(validateIban("DE5679350101000512418500")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(validateIban("")).toBe(false);
    expect(validateIban(null)).toBe(false);
    expect(validateIban(undefined)).toBe(false);
    expect(validateIban("DE56-7935-0101-0005-1241-85")).toBe(false);
    expect(validateIban("not an iban")).toBe(false);
  });
});

describe("normalizeIban", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeIban("de56 7935 0101 0005 1241 85")).toBe("DE56793501010005124185");
  });
});

describe("formatIbanGrouped", () => {
  it("groups by 4 chars", () => {
    expect(formatIbanGrouped("DE56793501010005124185")).toBe("DE56 7935 0101 0005 1241 85");
  });
});
