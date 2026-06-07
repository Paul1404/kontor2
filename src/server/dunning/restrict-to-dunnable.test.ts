import { describe, expect, it } from "vitest";
import { restrictToDunnable } from "./build-dunning";

type M = {
  memberId: string;
  openSum: string;
  postings: { sollStellungId: string; openAmount: string; rueckgebuhr: string }[];
};

const member = (id: string, postings: M["postings"]): M => ({
  memberId: id,
  openSum: "999.99", // deliberately stale; must be recomputed
  postings,
});

describe("restrictToDunnable", () => {
  it("drops postings that are no longer dunnable and recomputes openSum", () => {
    const eligible = [
      member("a", [
        { sollStellungId: "s1", openAmount: "10.00", rueckgebuhr: "0.00" },
        { sollStellungId: "s2", openAmount: "5.00", rueckgebuhr: "3.00" },
      ]),
    ];
    const out = restrictToDunnable(eligible, new Set(["s1"]));
    expect(out).toHaveLength(1);
    expect(out[0]!.postings.map((p) => p.sollStellungId)).toEqual(["s1"]);
    // openSum recomputed from the remaining posting only: 10.00 + 0.00.
    expect(out[0]!.openSum).toBe("10.00");
  });

  it("includes Rücklastgebühren in the recomputed openSum", () => {
    const eligible = [
      member("a", [{ sollStellungId: "s1", openAmount: "12.50", rueckgebuhr: "3.00" }]),
    ];
    const out = restrictToDunnable(eligible, new Set(["s1"]));
    expect(out[0]!.openSum).toBe("15.50");
  });

  it("removes members left with no dunnable postings", () => {
    const eligible = [
      member("a", [{ sollStellungId: "s1", openAmount: "10.00", rueckgebuhr: "0.00" }]),
      member("b", [{ sollStellungId: "s2", openAmount: "20.00", rueckgebuhr: "0.00" }]),
    ];
    // s2 was bumped by a concurrent run -> member b drops out entirely.
    const out = restrictToDunnable(eligible, new Set(["s1"]));
    expect(out.map((m) => m.memberId)).toEqual(["a"]);
  });

  it("returns empty when nothing is still dunnable", () => {
    const eligible = [
      member("a", [{ sollStellungId: "s1", openAmount: "10.00", rueckgebuhr: "0.00" }]),
    ];
    expect(restrictToDunnable(eligible, new Set())).toEqual([]);
  });
});
