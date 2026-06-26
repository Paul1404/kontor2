import { describe, expect, it } from "vitest";
import { isTargetBusinessDay, nextCollectionDate } from "~/server/sepa/business-days";

describe("isTargetBusinessDay", () => {
  it("accepts a normal weekday", () => {
    expect(isTargetBusinessDay("2026-06-26")).toBe(true); // Friday
  });
  it("rejects weekends", () => {
    expect(isTargetBusinessDay("2026-06-27")).toBe(false); // Saturday
    expect(isTargetBusinessDay("2026-06-28")).toBe(false); // Sunday
  });
  it("rejects TARGET2 holidays", () => {
    expect(isTargetBusinessDay("2026-01-01")).toBe(false); // New Year
    expect(isTargetBusinessDay("2026-05-01")).toBe(false); // Labour Day
    expect(isTargetBusinessDay("2026-12-25")).toBe(false); // Christmas
    expect(isTargetBusinessDay("2026-12-26")).toBe(false);
    expect(isTargetBusinessDay("2026-04-03")).toBe(false); // Good Friday 2026
    expect(isTargetBusinessDay("2026-04-06")).toBe(false); // Easter Monday 2026
  });
});

describe("nextCollectionDate", () => {
  it("skips the weekend", () => {
    expect(nextCollectionDate("2026-06-26", 1)).toBe("2026-06-29"); // Fri -> Mon
  });
  it("returns the next weekday on an ordinary day", () => {
    expect(nextCollectionDate("2026-06-29", 1)).toBe("2026-06-30"); // Mon -> Tue
  });
  it("skips a holiday", () => {
    expect(nextCollectionDate("2025-12-31", 1)).toBe("2026-01-02"); // skip 01-01
  });
});
