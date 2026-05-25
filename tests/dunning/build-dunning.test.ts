import { describe, expect, it } from "vitest";
import { mahngebuhrFor, sumDecimal } from "~/server/dunning/build-dunning";

describe("sumDecimal", () => {
  it("adds in integer cents to avoid float drift", () => {
    expect(sumDecimal(["0.10", "0.20"])).toBe("0.30");
    expect(sumDecimal(["10.00", "5.00", "2.50"])).toBe("17.50");
  });

  it("handles single value", () => {
    expect(sumDecimal(["12.34"])).toBe("12.34");
  });

  it("handles empty list", () => {
    expect(sumDecimal([])).toBe("0.00");
  });

  it("survives 0.1 + 0.2 without binary float artefacts", () => {
    expect(sumDecimal(["0.1", "0.2"])).toBe("0.30");
    // 100 increments of one cent: would drift in plain float arithmetic
    expect(sumDecimal(Array.from({ length: 100 }, () => "0.01"))).toBe("1.00");
  });
});

describe("mahngebuhrFor", () => {
  const org = { mahngebuhr1: "0", mahngebuhr2: "5", mahngebuhr3: "10" };

  it("returns the configured fee per level", () => {
    expect(mahngebuhrFor(1, org)).toBe("0");
    expect(mahngebuhrFor(2, org)).toBe("5");
    expect(mahngebuhrFor(3, org)).toBe("10");
  });

  it("clamps unexpected levels to nearest", () => {
    expect(mahngebuhrFor(0, org)).toBe("0");
    expect(mahngebuhrFor(4, org)).toBe("10");
  });
});
