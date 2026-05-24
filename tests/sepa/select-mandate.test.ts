import { describe, expect, it } from "vitest";
import type { SepaMandate } from "~/server/db/schema/sepa";
import { selectMandate, sequenceTypeFor } from "~/server/sepa/select-mandate";

function makeMandate(over: Partial<SepaMandate>): SepaMandate {
  return {
    id: "m1",
    memberId: "u1",
    adrNr: 1,
    mandatsNr: "M1",
    mandKey: null,
    lastschriftart: null,
    typ: null,
    status: "Aktiv",
    angelegtAm: new Date("2020-01-01"),
    gultigBis: null,
    unterschriftDatum: new Date("2020-01-01"),
    ersteVerwendung: null,
    letzteVerwendung: null,
    widerrufenAm: null,
    gueltigAb: null,
    letzteVerwendungAlt: null,
    gultigBisAlt: null,
    isDeleted: false,
    importBatchId: null,
    updatedAt: new Date(),
    ...over,
  };
}

describe("selectMandate", () => {
  it("returns null when no active mandates", () => {
    const sel = selectMandate([]);
    expect(sel.chosen).toBe(null);
    expect(sel.conflict).toBe(false);
  });

  it("picks the only active one", () => {
    const m = makeMandate({ id: "x" });
    const sel = selectMandate([m]);
    expect(sel.chosen?.id).toBe("x");
    expect(sel.conflict).toBe(false);
  });

  it("excludes revoked, deleted, and expired", () => {
    const today = new Date("2026-05-01");
    const mandates = [
      makeMandate({ id: "revoked", widerrufenAm: new Date("2025-01-01") }),
      makeMandate({ id: "deleted", isDeleted: true }),
      makeMandate({ id: "expired", gultigBis: new Date("2024-01-01") }),
      makeMandate({ id: "inaktiv", status: "Inaktiv" }),
      makeMandate({ id: "good" }),
    ];
    const sel = selectMandate(mandates, undefined, today);
    expect(sel.chosen?.id).toBe("good");
    expect(sel.conflict).toBe(false);
  });

  it("returns newest when multiple active and flags conflict", () => {
    const mandates = [
      makeMandate({ id: "old", angelegtAm: new Date("2020-01-01") }),
      makeMandate({ id: "new", angelegtAm: new Date("2024-01-01") }),
    ];
    const sel = selectMandate(mandates);
    expect(sel.chosen?.id).toBe("new");
    expect(sel.conflict).toBe(true);
    expect(sel.options.map((o) => o.id)).toEqual(["new", "old"]);
  });

  it("honours override when it matches an active mandate", () => {
    const mandates = [
      makeMandate({ id: "old", angelegtAm: new Date("2020-01-01") }),
      makeMandate({ id: "new", angelegtAm: new Date("2024-01-01") }),
    ];
    const sel = selectMandate(mandates, "old");
    expect(sel.chosen?.id).toBe("old");
    expect(sel.conflict).toBe(true);
  });

  it("falls back to default when override is invalid", () => {
    const mandates = [makeMandate({ id: "good" })];
    const sel = selectMandate(mandates, "nonexistent");
    expect(sel.chosen?.id).toBe("good");
  });
});

describe("sequenceTypeFor", () => {
  it("returns FRST when never used", () => {
    expect(sequenceTypeFor(makeMandate({ ersteVerwendung: null }))).toBe("FRST");
  });
  it("returns RCUR after first use", () => {
    expect(sequenceTypeFor(makeMandate({ ersteVerwendung: new Date("2024-01-01") }))).toBe("RCUR");
  });
});
