import { describe, expect, it } from "vitest";
import { buildPain008, type Pain008Item } from "~/server/sepa/pain008";

const creditor = {
  name: "Sportverein 1945 Untereuerheim e.V.",
  iban: "DE56793501010005124185",
  bic: "BYLADEM1KSW",
  glaeubigerId: "DE71ZZZ00000901082",
};

const baseItem: Pain008Item = {
  endToEndId: "E2E1",
  amount: "54.00",
  mandateRef: "375093911",
  mandateSignatureDate: "2020-03-26",
  debtorName: "Otmar Walter",
  debtorIban: "DE13790690100007640404",
  purpose: "Mitgliedsbeitrag 2026",
  sequenceType: "RCUR",
};

const build = (item: Pain008Item) =>
  buildPain008({
    creditor,
    falligkeitsdatum: "2026-06-30",
    msgId: "TEST-1",
    pmtInfIdPrefix: "TEST-1",
    items: [item],
  });

describe("buildPain008 debtor BIC", () => {
  it("derives the BIC from the IBAN when none is stored", () => {
    const xml = build({ ...baseItem, debtorBic: null });
    expect(xml).toContain("<BIC>GENODEF1ATE</BIC>");
    expect(xml).not.toContain("NOTPROVIDED");
  });

  it("uses the stored BIC when present", () => {
    const xml = build({ ...baseItem, debtorBic: "BYLADEM1KSW" });
    expect(xml).toContain("<BIC>BYLADEM1KSW</BIC>");
  });

  it("falls back to NOTPROVIDED for an unknown (non-DE) bank", () => {
    const xml = build({ ...baseItem, debtorBic: null, debtorIban: "AT611904300234573201" });
    expect(xml).toContain("NOTPROVIDED");
  });
});
