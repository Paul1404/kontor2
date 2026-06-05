import { describe, expect, it } from "vitest";
import {
  buildScrubRules,
  earliestErasureDate,
  RETAINED_COLUMNS,
  RETENTION_YEARS,
} from "~/server/dsgvo/policy";

describe("buildScrubRules", () => {
  it("uses a deterministic pseudonym tied to the member id", () => {
    const a = buildScrubRules("11111111-aaaa-bbbb-cccc-222222222222");
    const b = buildScrubRules("11111111-aaaa-bbbb-cccc-222222222222");
    expect(a.vorname).toEqual(b.vorname);
    expect(a.vorname).toEqual({ kind: "pseudonym", value: "Anonym-11111111" });
  });

  it("scrubs all known PII columns", () => {
    const rules = buildScrubRules("ffffffff-0000-0000-0000-000000000000");
    // sample of the categories
    expect(rules.eMailName).toEqual({ kind: "null" });
    expect(rules.email).toEqual({ kind: "null" }); // clean column must be scrubbed too
    expect(rules.telefon1).toEqual({ kind: "null" });
    expect(rules.iban1).toEqual({ kind: "null" });
    expect(rules.bic1).toEqual({ kind: "null" });
    expect(rules.geburtsdatum).toEqual({ kind: "null" });
    expect(rules.ausweisnummer).toEqual({ kind: "null" });
  });

  it("does not touch retained columns", () => {
    const rules = buildScrubRules("ffffffff-0000-0000-0000-000000000000");
    for (const c of RETAINED_COLUMNS) {
      expect(rules[c]).toBeUndefined();
    }
  });
});

describe("earliestErasureDate", () => {
  it("returns epoch when there is no financial activity at all", () => {
    const d = earliestErasureDate({
      austritt: null,
      verstorbenAm: null,
      lastFinancialEventAt: null,
    });
    expect(d.getTime()).toBe(0);
  });

  it("applies 10-year retention to the last financial event", () => {
    const last = new Date("2020-06-15T00:00:00.000Z");
    const d = earliestErasureDate({
      austritt: null,
      verstorbenAm: null,
      lastFinancialEventAt: last,
    });
    expect(d.toISOString()).toBe(`2030-06-15T00:00:00.000Z`);
  });

  it("uses the latest of austritt/verstorben/financial-event + retention", () => {
    const earlierAustritt = new Date("2018-01-01T00:00:00.000Z");
    const laterFinancial = new Date("2022-12-31T00:00:00.000Z");
    const d = earliestErasureDate({
      austritt: earlierAustritt,
      verstorbenAm: null,
      lastFinancialEventAt: laterFinancial,
    });
    expect(d.toISOString()).toBe("2032-12-31T00:00:00.000Z");
  });

  it("documents the retention constants", () => {
    expect(RETENTION_YEARS.financial).toBe(10);
    expect(RETENTION_YEARS.commercial).toBe(6);
    expect(RETENTION_YEARS.sepaMandateMonths).toBe(14);
  });
});
