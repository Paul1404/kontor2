import { describe, expect, it } from "vitest";
import { amountStrToCents, centsToAmount } from "~/server/sepa/build-fee-run";

describe("amountStrToCents", () => {
  it("parses positive decimals", () => {
    expect(amountStrToCents("5.50")).toBe(550n);
    expect(amountStrToCents("0.01")).toBe(1n);
    expect(amountStrToCents("100")).toBe(10000n);
    expect(amountStrToCents("12.3")).toBe(1230n);
  });

  it("parses negative decimals with the sign on the whole magnitude", () => {
    // Regression: the old impl returned -450 here.
    expect(amountStrToCents("-5.50")).toBe(-550n);
    expect(amountStrToCents("-0.99")).toBe(-99n);
  });

  it("handles a leading plus and surrounding whitespace", () => {
    expect(amountStrToCents("+5.50")).toBe(550n);
    expect(amountStrToCents("  7.00 ")).toBe(700n);
  });

  it("truncates beyond two fractional digits", () => {
    expect(amountStrToCents("1.999")).toBe(199n);
  });
});

describe("centsToAmount", () => {
  it("formats positive and negative cents", () => {
    expect(centsToAmount(550n)).toBe("5.50");
    expect(centsToAmount(1n)).toBe("0.01");
    expect(centsToAmount(-550n)).toBe("-5.50");
  });

  it("round-trips with amountStrToCents", () => {
    for (const s of ["5.50", "0.00", "123.45", "-5.50"]) {
      expect(centsToAmount(amountStrToCents(s))).toBe(s);
    }
  });
});
