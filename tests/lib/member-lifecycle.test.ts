import { describe, expect, it } from "vitest";
import {
  type AbteilungRow,
  type ContractRow,
  planAustrittCascade,
  planReactivateCascade,
  type SepaRow,
  toIsoDay,
} from "~/server/lib/member-lifecycle";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("toIsoDay", () => {
  it("returns null for null/undefined", () => {
    expect(toIsoDay(null)).toBeNull();
    expect(toIsoDay(undefined)).toBeNull();
  });

  it("passes through a YYYY-MM-DD string", () => {
    expect(toIsoDay("2026-06-30")).toBe("2026-06-30");
  });

  it("truncates an ISO timestamp to the UTC day", () => {
    expect(toIsoDay("2026-06-30T22:15:00.000Z")).toBe("2026-06-30");
    expect(toIsoDay(day("2026-06-30"))).toBe("2026-06-30");
  });

  it("returns null for an unparseable string", () => {
    expect(toIsoDay("not-a-date")).toBeNull();
  });
});

describe("planAustrittCascade", () => {
  const abteilungen: AbteilungRow[] = [
    { abteilungId: "fussball", eintrittsdatum: "2010-01-01", austrittsdatum: null },
    { abteilungId: "tennis", eintrittsdatum: "2015-01-01", austrittsdatum: null },
    // Already left this one earlier — must be untouched.
    { abteilungId: "turnen", eintrittsdatum: "2012-01-01", austrittsdatum: "2020-12-31" },
  ];
  const contracts: ContractRow[] = [
    { id: "c-open", gekuendZum: null },
    { id: "c-closed", gekuendZum: day("2019-06-30") },
  ];
  const sepa: SepaRow[] = [
    { id: "s-active", isDeleted: false, widerrufenAm: null },
    { id: "s-revoked", isDeleted: false, widerrufenAm: day("2018-01-01") },
    { id: "s-deleted", isDeleted: true, widerrufenAm: null },
  ];

  it("closes all open departments and contracts, revokes active mandates", () => {
    const plan = planAustrittCascade({
      austrittDatum: "2026-06-30",
      abteilungen,
      contracts,
      sepa,
      revokeSepa: true,
    });
    expect(plan.abteilungClose.map((a) => a.abteilungId)).toEqual(["fussball", "tennis"]);
    expect(plan.contractClose).toEqual(["c-open"]);
    expect(plan.sepaRevoke).toEqual(["s-active"]);
  });

  it("leaves SEPA untouched when revokeSepa is false", () => {
    const plan = planAustrittCascade({
      austrittDatum: "2026-06-30",
      abteilungen,
      contracts,
      sepa,
      revokeSepa: false,
    });
    expect(plan.sepaRevoke).toEqual([]);
  });

  it("restricts department closing when abteilungIds is given", () => {
    const plan = planAustrittCascade({
      austrittDatum: "2026-06-30",
      abteilungen,
      contracts,
      sepa,
      revokeSepa: true,
      abteilungIds: ["tennis"],
    });
    expect(plan.abteilungClose.map((a) => a.abteilungId)).toEqual(["tennis"]);
  });

  it("is a no-op on a member who already fully left", () => {
    const plan = planAustrittCascade({
      austrittDatum: "2026-06-30",
      abteilungen: [
        { abteilungId: "turnen", eintrittsdatum: "2012-01-01", austrittsdatum: "2020-12-31" },
      ],
      contracts: [{ id: "c-closed", gekuendZum: day("2019-06-30") }],
      sepa: [{ id: "s-revoked", isDeleted: false, widerrufenAm: day("2018-01-01") }],
      revokeSepa: true,
    });
    expect(plan.abteilungClose).toEqual([]);
    expect(plan.contractClose).toEqual([]);
    expect(plan.sepaRevoke).toEqual([]);
  });
});

describe("planReactivateCascade", () => {
  it("reopens exactly the rows closed on the leave day", () => {
    const plan = planReactivateCascade({
      austrittDatum: "2026-06-30",
      abteilungen: [
        { abteilungId: "fussball", eintrittsdatum: "2010-01-01", austrittsdatum: "2026-06-30" },
        // Closed on a different, earlier day — keep it closed.
        { abteilungId: "turnen", eintrittsdatum: "2012-01-01", austrittsdatum: "2020-12-31" },
      ],
      contracts: [
        { id: "c1", gekuendZum: day("2026-06-30"), vertragEnde: day("2026-06-30") },
        { id: "c2", gekuendZum: day("2019-06-30"), vertragEnde: day("2019-06-30") },
      ],
      sepa: [
        { id: "s1", widerrufenAm: day("2026-06-30"), gultigBis: day("2026-06-30") },
        { id: "s2", widerrufenAm: day("2018-01-01"), gultigBis: day("2018-01-01") },
      ],
    });
    expect(plan.abteilungReopen.map((a) => a.abteilungId)).toEqual(["fussball"]);
    expect(plan.contractReopen).toEqual([{ id: "c1", clearVertragEnde: true }]);
    expect(plan.sepaReopen).toEqual([{ id: "s1", clearGultigBis: true }]);
  });

  it("keeps a divergent vertragEnde/gultigBis when only gekuendZum matches", () => {
    const plan = planReactivateCascade({
      austrittDatum: "2026-06-30",
      abteilungen: [],
      contracts: [{ id: "c1", gekuendZum: day("2026-06-30"), vertragEnde: day("2027-12-31") }],
      sepa: [{ id: "s1", widerrufenAm: day("2026-06-30"), gultigBis: day("2027-12-31") }],
    });
    expect(plan.contractReopen).toEqual([{ id: "c1", clearVertragEnde: false }]);
    expect(plan.sepaReopen).toEqual([{ id: "s1", clearGultigBis: false }]);
  });
});
