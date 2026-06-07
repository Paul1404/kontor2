import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { membersTable } from "~/server/db/schema/members";
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
    expect(rules.email).toEqual({ kind: "null" });
    expect(rules.telefon1).toEqual({ kind: "null" });
    expect(rules.iban1).toEqual({ kind: "null" });
    expect(rules.bic1).toEqual({ kind: "null" });
    expect(rules.geburtsdatum).toEqual({ kind: "null" });
    expect(rules.strasse).toEqual({ kind: "null" });
  });

  it("does not touch retained columns", () => {
    const rules = buildScrubRules("ffffffff-0000-0000-0000-000000000000");
    for (const c of RETAINED_COLUMNS) {
      expect(rules[c]).toBeUndefined();
    }
  });

  it("only references columns that actually exist on the members table", () => {
    // Guards against rules for columns dropped in the schema trim, which would
    // silently scrub nothing and let PII survive erasure.
    const columns = new Set(Object.keys(getTableColumns(membersTable)));
    for (const key of Object.keys(buildScrubRules("ffffffff-0000-0000-0000-000000000000"))) {
      expect(columns.has(key), `scrub rule "${key}" is not a members column`).toBe(true);
    }
  });

  it("scrubs the legal-representative (guardian) and alt-account-holder PII", () => {
    const rules = buildScrubRules("ffffffff-0000-0000-0000-000000000000");
    for (const key of [
      "vertreterAnrede",
      "vertreterName",
      "vertreterStrasse",
      "vertreterHausnummer",
      "vertreterPlz",
      "vertreterOrt",
      "abwKontoInh",
    ]) {
      expect(rules[key]).toEqual({ kind: "null" });
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
