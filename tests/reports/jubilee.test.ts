import { describe, expect, it } from "vitest";
import { isExcludedFromJubilee, jubileeDateFor, jubileeYearFor } from "~/server/reports/jubilee";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("jubileeYearFor", () => {
  it("computes the 25-year jubilee year", () => {
    expect(jubileeYearFor(utc(2000, 2, 15), 25)).toBe(2025);
  });

  it("computes the 50-year jubilee year", () => {
    expect(jubileeYearFor(utc(1975, 7, 1), 50)).toBe(2025);
  });

  it("works at leap-year boundaries", () => {
    expect(jubileeYearFor(utc(2000, 2, 29), 25)).toBe(2025);
  });
});

describe("jubileeDateFor", () => {
  it("preserves day and month of the original eintritt", () => {
    const d = jubileeDateFor(utc(2000, 2, 15), 25);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(15);
  });

  it("clamps a Feb 29 entry to Feb 28 in a non-leap jubilee year (no roll into March)", () => {
    const d = jubileeDateFor(utc(2000, 2, 29), 25);
    expect(d.getUTCFullYear()).toBe(2025);
    expect(d.getUTCMonth()).toBe(1); // February, not March
    expect(d.getUTCDate()).toBe(28);
  });

  it("keeps Feb 29 when the jubilee year is itself a leap year", () => {
    const d = jubileeDateFor(utc(2000, 2, 29), 20);
    expect(d.getUTCFullYear()).toBe(2020);
    expect(d.getUTCMonth()).toBe(1);
    expect(d.getUTCDate()).toBe(29);
  });
});

describe("isExcludedFromJubilee", () => {
  const jub = jubileeDateFor(utc(2000, 2, 15), 25);

  it("includes a still-active member", () => {
    expect(isExcludedFromJubilee({ austritt: null, verstorbenAm: null }, jub)).toBe(false);
  });

  it("excludes a member who exited before the jubilee", () => {
    expect(isExcludedFromJubilee({ austritt: utc(2024, 12, 31), verstorbenAm: null }, jub)).toBe(
      true,
    );
  });

  it("excludes a member who died before the jubilee", () => {
    expect(isExcludedFromJubilee({ austritt: null, verstorbenAm: utc(2024, 6, 1) }, jub)).toBe(
      true,
    );
  });

  it("includes a member who exited after the jubilee", () => {
    expect(isExcludedFromJubilee({ austritt: utc(2025, 12, 31), verstorbenAm: null }, jub)).toBe(
      false,
    );
  });

  it("includes a member who exited exactly on the jubilee date", () => {
    expect(isExcludedFromJubilee({ austritt: jub, verstorbenAm: null }, jub)).toBe(false);
  });
});
