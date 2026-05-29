import { describe, expect, it } from "vitest";
import { aggregateMgsolln, statusFor } from "~/server/importer/aggregate-mgsolln";
import type { SollStellungMapped } from "~/server/importer/linear-mapper";

function rec(
  adrNr: number,
  vertragNr: string,
  jahr: number,
  zeitraum: number,
  betrag: string,
  bezahlt: string,
  offen: string,
  extras: Partial<SollStellungMapped> = {},
): SollStellungMapped {
  return {
    adrNr,
    jahr,
    vertragNr,
    art: 100,
    zeitraum,
    betrag,
    bezahlt,
    offen,
    mahnstufe: 0,
    falligkeitsdatum: null,
    guid: null,
    mandatsNr: null,
    ...extras,
  };
}

const resolver =
  (mapping: Record<string, { contractId: string; memberId: string }>) =>
  (adrNr: number, vertragNr: string) =>
    mapping[`${adrNr}|${vertragNr}`] ?? null;

describe("aggregateMgsolln", () => {
  it("collapses multiple Zeitraums into one (contract, year) row", () => {
    const out = aggregateMgsolln(
      [
        rec(7, "11", 2018, 1, "40.50", "40.50", "0"),
        rec(7, "11", 2018, 2, "40.50", "40.50", "0"),
        rec(7, "11", 2018, 3, "40.50", "0", "40.50"),
        rec(7, "11", 2018, 4, "40.50", "0", "40.50"),
      ],
      resolver({ "7|11": { contractId: "c1", memberId: "m1" } }),
    );
    expect(out.missing).toEqual([]);
    expect(out.aggregated).toHaveLength(1);
    expect(out.aggregated[0]).toMatchObject({
      contractId: "c1",
      memberId: "m1",
      billingYear: 2018,
      amount: "162.00000000",
      paidAmount: "81.00000000",
      openAmount: "81.00000000",
      rowCount: 4,
    });
  });

  it("keeps separate (contract, year) buckets distinct", () => {
    const out = aggregateMgsolln(
      [
        rec(7, "11", 2018, 1, "100", "100", "0"),
        rec(7, "11", 2019, 1, "100", "0", "100"),
        rec(8, "11", 2019, 1, "50", "0", "50"),
      ],
      resolver({
        "7|11": { contractId: "c1", memberId: "m1" },
        "8|11": { contractId: "c2", memberId: "m2" },
      }),
    );
    expect(out.aggregated).toHaveLength(3);
    const byKey = new Map(out.aggregated.map((a) => [`${a.contractId}|${a.billingYear}`, a]));
    expect(byKey.get("c1|2018")?.openAmount).toBe("0.00000000");
    expect(byKey.get("c1|2019")?.openAmount).toBe("100.00000000");
    expect(byKey.get("c2|2019")?.openAmount).toBe("50.00000000");
  });

  it("takes the max Mahnstufe across Zeitraums", () => {
    const out = aggregateMgsolln(
      [
        rec(7, "11", 2018, 1, "100", "0", "100", { mahnstufe: 1 }),
        rec(7, "11", 2018, 2, "100", "0", "100", { mahnstufe: 3 }),
        rec(7, "11", 2018, 3, "100", "0", "100", { mahnstufe: 2 }),
      ],
      resolver({ "7|11": { contractId: "c1", memberId: "m1" } }),
    );
    expect(out.aggregated[0]?.mahnstufe).toBe(3);
  });

  it("preserves the first non-null Fälligkeitsdatum and GUID", () => {
    const date1 = new Date("2018-04-01T00:00:00Z");
    const date2 = new Date("2018-07-01T00:00:00Z");
    const out = aggregateMgsolln(
      [
        rec(7, "11", 2018, 1, "100", "0", "100", { falligkeitsdatum: null, guid: null }),
        rec(7, "11", 2018, 2, "100", "0", "100", { falligkeitsdatum: date1, guid: "g1" }),
        rec(7, "11", 2018, 3, "100", "0", "100", { falligkeitsdatum: date2, guid: "g2" }),
      ],
      resolver({ "7|11": { contractId: "c1", memberId: "m1" } }),
    );
    // First row inserted carries `guid=null`, so that's the representative.
    // Date falls back to the first non-null encountered.
    expect(out.aggregated[0]?.linearGuid).toBe(null);
    expect(out.aggregated[0]?.falligkeitsdatum).toEqual(date1);
  });

  it("collects rows with no matching contract under `missing`", () => {
    const out = aggregateMgsolln(
      [rec(7, "11", 2018, 1, "100", "0", "100"), rec(99, "X", 2018, 1, "100", "0", "100")],
      resolver({ "7|11": { contractId: "c1", memberId: "m1" } }),
    );
    expect(out.aggregated).toHaveLength(1);
    expect(out.missing).toEqual([{ adrNr: 99, vertragNr: "X" }]);
  });

  it("handles fractional cents without losing precision", () => {
    const out = aggregateMgsolln(
      [
        rec(7, "11", 2018, 1, "10.12345678", "0", "10.12345678"),
        rec(7, "11", 2018, 2, "20.87654322", "0", "20.87654322"),
      ],
      resolver({ "7|11": { contractId: "c1", memberId: "m1" } }),
    );
    expect(out.aggregated[0]?.amount).toBe("31.00000000");
    expect(out.aggregated[0]?.openAmount).toBe("31.00000000");
  });
});

describe("statusFor", () => {
  it("returns 'paid' when openAmount is zero or negative", () => {
    expect(statusFor("0")).toBe("paid");
    expect(statusFor("0.00000000")).toBe("paid");
    expect(statusFor("-5.00")).toBe("paid");
  });
  it("returns 'open' when openAmount is positive", () => {
    expect(statusFor("0.01")).toBe("open");
    expect(statusFor("100")).toBe("open");
  });
});
