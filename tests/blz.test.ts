import { describe, it, expect } from "vitest";
import { extractBankCode, lookupBankByBlz, lookupBankByIban } from "~/server/lib/blz";

describe("blz lookup", () => {
  it("extracts the BLZ from a DE IBAN", () => {
    expect(extractBankCode("DE89370400440532013000")).toEqual({
      country: "DE",
      bankCode: "37040044",
    });
  });

  it("returns null for non-DE IBANs", () => {
    expect(extractBankCode("AT611904300234573201")).toBeNull();
  });

  it("looks up Commerzbank by BLZ", () => {
    const hit = lookupBankByBlz("37040044");
    expect(hit).not.toBeNull();
    expect(hit?.bic).toMatch(/^COBA/);
    expect(hit?.name.toLowerCase()).toContain("commerzbank");
  });

  it("looks up by IBAN", () => {
    const hit = lookupBankByIban("DE89370400440532013000");
    expect(hit).not.toBeNull();
    expect(hit?.bic).toMatch(/^COBA/);
  });

  it("returns null for unknown BLZ", () => {
    expect(lookupBankByBlz("99999999")).toBeNull();
  });
});
