import { describe, expect, it } from "vitest";
import { headerCheckState, rangeIds } from "~/lib/selection";

const ROWS = ["a", "b", "c", "d", "e"];

describe("rangeIds", () => {
  it("returns the inclusive range when anchor precedes target", () => {
    expect(rangeIds(ROWS, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("is order-independent (target before anchor)", () => {
    expect(rangeIds(ROWS, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns a single id when anchor equals target", () => {
    expect(rangeIds(ROWS, "c", "c")).toEqual(["c"]);
  });

  it("falls back to just the target when the anchor is stale", () => {
    expect(rangeIds(ROWS, "zzz", "c")).toEqual(["c"]);
  });

  it("returns empty when the target is unknown", () => {
    expect(rangeIds(ROWS, "a", "zzz")).toEqual([]);
  });
});

describe("headerCheckState", () => {
  it("is none for empty rows", () => {
    expect(headerCheckState([], new Set(["a"]))).toBe("none");
  });

  it("is none when nothing on the page is selected", () => {
    expect(headerCheckState(ROWS, new Set(["x"]))).toBe("none");
  });

  it("is some when a subset is selected", () => {
    expect(headerCheckState(ROWS, new Set(["a", "c"]))).toBe("some");
  });

  it("is all when every visible row is selected", () => {
    expect(headerCheckState(ROWS, new Set(ROWS))).toBe("all");
  });

  it("ignores selected ids that are not visible", () => {
    expect(headerCheckState(["a", "b"], new Set(["a", "b", "c"]))).toBe("all");
  });
});
