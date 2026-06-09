import { describe, expect, it } from "vitest";
import { recollectionBlockReason } from "~/server/sepa/build-recollection";

const ok = {
  directDebitBlocked: false,
  isDirectDebit: true,
  hasMandate: true,
  hasIban: true,
};

describe("recollectionBlockReason", () => {
  it("returns null when everything is in place", () => {
    expect(recollectionBlockReason(ok)).toBeNull();
  });

  it("blocks when direct debit is suspended", () => {
    expect(recollectionBlockReason({ ...ok, directDebitBlocked: true })).toBe("Einzug ausgesetzt");
  });

  it("blocks when the contract is not a direct-debit contract", () => {
    expect(recollectionBlockReason({ ...ok, isDirectDebit: false })).toBe(
      "Lastschrift nicht aktiv",
    );
  });

  it("blocks when there is no active mandate", () => {
    expect(recollectionBlockReason({ ...ok, hasMandate: false })).toBe("Kein aktives SEPA-Mandat");
  });

  it("blocks when no IBAN is stored", () => {
    expect(recollectionBlockReason({ ...ok, hasIban: false })).toBe("Keine IBAN hinterlegt");
  });

  it("prefers the suspended-debit reason over a missing mandate", () => {
    // The Einzug-Sperre is the operator's deliberate hold, so it should be the
    // surfaced reason even if the mandate is also missing.
    expect(
      recollectionBlockReason({
        directDebitBlocked: true,
        isDirectDebit: false,
        hasMandate: false,
        hasIban: false,
      }),
    ).toBe("Einzug ausgesetzt");
  });

  it("reports a missing mandate before a missing IBAN", () => {
    expect(recollectionBlockReason({ ...ok, hasMandate: false, hasIban: false })).toBe(
      "Kein aktives SEPA-Mandat",
    );
  });
});
