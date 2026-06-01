import { describe, expect, it } from "vitest";
import { isDunningBlocked } from "~/server/dunning/build-dunning";

describe("isDunningBlocked", () => {
  it("is not blocked for empty / null / sentinel values", () => {
    expect(isDunningBlocked(null)).toBe(false);
    expect(isDunningBlocked(undefined)).toBe(false);
    expect(isDunningBlocked("")).toBe(false);
    expect(isDunningBlocked("0")).toBe(false);
  });

  it("treats whitespace-only as not blocked (regression: a stray space blocked all dunning)", () => {
    expect(isDunningBlocked(" ")).toBe(false);
    expect(isDunningBlocked("  ")).toBe(false);
    expect(isDunningBlocked(" 0 ")).toBe(false);
  });

  it("is blocked for any other non-empty value", () => {
    expect(isDunningBlocked("1")).toBe(true);
    expect(isDunningBlocked("J")).toBe(true);
    expect(isDunningBlocked("gesperrt")).toBe(true);
  });
});
