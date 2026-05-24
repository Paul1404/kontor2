import { describe, expect, it } from "vitest";
import { formatLand } from "~/lib/country";

describe("formatLand", () => {
  it("maps 1 to Deutschland", () => {
    expect(formatLand("1")).toBe("Deutschland");
  });

  it("maps 2 to Österreich", () => {
    expect(formatLand("2")).toBe("Österreich");
  });

  it("passes free-text country names through", () => {
    expect(formatLand("Deutschland")).toBe("Deutschland");
    expect(formatLand("USA")).toBe("USA");
  });

  it("returns empty string for null/empty", () => {
    expect(formatLand(null)).toBe("");
    expect(formatLand(undefined)).toBe("");
    expect(formatLand("")).toBe("");
    expect(formatLand("  ")).toBe("");
  });
});
