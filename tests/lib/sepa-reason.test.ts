import { describe, expect, it } from "vitest";
import {
  formatSepaReturnReason,
  SEPA_RETURN_REASON_OPTIONS,
  sepaReturnReasonLabel,
} from "~/lib/sepa-reason";

describe("sepaReturnReasonLabel", () => {
  it("maps known codes case-insensitively and trims", () => {
    expect(sepaReturnReasonLabel("MS03")).toBe("Kein Grund angegeben");
    expect(sepaReturnReasonLabel("  ms03 ")).toBe("Kein Grund angegeben");
    expect(sepaReturnReasonLabel("ac04")).toBe("Konto geschlossen");
  });

  it("returns null for unknown or empty codes", () => {
    expect(sepaReturnReasonLabel("ZZ99")).toBeNull();
    expect(sepaReturnReasonLabel("")).toBeNull();
    expect(sepaReturnReasonLabel(null)).toBeNull();
    expect(sepaReturnReasonLabel(undefined)).toBeNull();
  });
});

describe("formatSepaReturnReason", () => {
  it("renders 'CODE: Label' for known codes", () => {
    expect(formatSepaReturnReason("AM04")).toBe("AM04: Konto ohne Deckung");
  });

  it("falls back to the bare uppercased code when unknown", () => {
    expect(formatSepaReturnReason("zz99")).toBe("ZZ99");
  });

  it("returns null for empty input", () => {
    expect(formatSepaReturnReason(null)).toBeNull();
  });
});

describe("SEPA_RETURN_REASON_OPTIONS", () => {
  it("is sorted by code and label-prefixed", () => {
    const codes = SEPA_RETURN_REASON_OPTIONS.map((o) => o.code);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
    const am04 = SEPA_RETURN_REASON_OPTIONS.find((o) => o.code === "AM04");
    expect(am04?.label).toBe("AM04: Konto ohne Deckung");
  });
});
