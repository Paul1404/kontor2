import { describe, expect, it } from "vitest";
import { LSB_AGE_BUCKETS } from "~/server/verbandsmeldung/bestandserhebung";

describe("LSB_AGE_BUCKETS", () => {
  it("matches the DOSB Bestandserhebungs-Schema", () => {
    expect(LSB_AGE_BUCKETS.map((b) => b.label)).toEqual([
      "0-6",
      "7-14",
      "15-18",
      "19-26",
      "27-40",
      "41-60",
      "61+",
    ]);
  });

  it("covers every non-negative age without gaps", () => {
    // Every integer 0..120 must fall in exactly one bucket.
    for (let age = 0; age <= 120; age += 1) {
      const matches = LSB_AGE_BUCKETS.filter((b) => age >= b.min && age <= b.max);
      expect(matches.length, `age ${age} should be in exactly one bucket`).toBe(1);
    }
  });

  it("places the bucket boundaries on the LSB cutoffs", () => {
    // Spot-check: 14-year-old is "7-14", 15-year-old is "15-18", 60 is "41-60", 61 is "61+".
    const find = (age: number) =>
      LSB_AGE_BUCKETS.find((b) => age >= b.min && age <= b.max)?.label;
    expect(find(14)).toBe("7-14");
    expect(find(15)).toBe("15-18");
    expect(find(60)).toBe("41-60");
    expect(find(61)).toBe("61+");
  });
});
