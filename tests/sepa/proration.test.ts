import { describe, expect, it } from "vitest";
import { computeProration } from "~/server/sepa/build-fee-run";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("computeProration", () => {
  it("modus 'voll' always returns full factor regardless of dates", () => {
    expect(
      computeProration({ start: null, end: null, year: 2026, modus: "voll", einheit: "monat" }),
    ).toEqual({
      factor: 1,
      label: null,
    });
    expect(
      computeProration({
        start: utc(2026, 4, 1),
        end: utc(2026, 6, 30),
        year: 2026,
        modus: "voll",
        einheit: "tag",
      }),
    ).toEqual({ factor: 1, label: null });
  });

  describe("monatsgenau", () => {
    it("full year (no dates) charges full amount", () => {
      expect(
        computeProration({
          start: null,
          end: null,
          year: 2026,
          modus: "anteilig",
          einheit: "monat",
        }),
      ).toEqual({ factor: 1, label: null });
    });

    it("joined in April with no end → 9/12", () => {
      const r = computeProration({
        start: utc(2026, 4, 15),
        end: null,
        year: 2026,
        modus: "anteilig",
        einheit: "monat",
      });
      expect(r.factor).toBeCloseTo(9 / 12);
      expect(r.label).toBe("9/12 Monate");
    });

    it("joined March, left August (same year) → 6/12", () => {
      const r = computeProration({
        start: utc(2026, 3, 1),
        end: utc(2026, 8, 31),
        year: 2026,
        modus: "anteilig",
        einheit: "monat",
      });
      expect(r.factor).toBeCloseTo(6 / 12);
      expect(r.label).toBe("6/12 Monate");
    });

    it("start before the year is clamped to January", () => {
      const r = computeProration({
        start: utc(2025, 6, 1),
        end: utc(2026, 6, 30),
        year: 2026,
        modus: "anteilig",
        einheit: "monat",
      });
      expect(r.factor).toBeCloseTo(6 / 12);
    });

    it("interval entirely outside the year → 0", () => {
      const r = computeProration({
        start: utc(2027, 1, 1),
        end: null,
        year: 2026,
        modus: "anteilig",
        einheit: "monat",
      });
      expect(r.factor).toBe(0);
    });
  });

  describe("taggenau", () => {
    it("full non-leap year → factor 1", () => {
      const r = computeProration({
        start: null,
        end: null,
        year: 2025,
        modus: "anteilig",
        einheit: "tag",
      });
      expect(r).toEqual({ factor: 1, label: null });
    });

    it("leap year uses 366 as denominator", () => {
      // 2028 is a leap year. A single day membership → 1/366.
      const r = computeProration({
        start: utc(2028, 1, 1),
        end: utc(2028, 1, 1),
        year: 2028,
        modus: "anteilig",
        einheit: "tag",
      });
      expect(r.label).toBe("1/366 Tage");
      expect(r.factor).toBeCloseTo(1 / 366);
    });

    it("counts active days inclusively", () => {
      // Jan 1 to Jan 10 inclusive = 10 days of 365 in 2026.
      const r = computeProration({
        start: utc(2026, 1, 1),
        end: utc(2026, 1, 10),
        year: 2026,
        modus: "anteilig",
        einheit: "tag",
      });
      expect(r.label).toBe("10/365 Tage");
      expect(r.factor).toBeCloseTo(10 / 365);
    });

    it("end before start → 0", () => {
      const r = computeProration({
        start: utc(2026, 8, 1),
        end: utc(2026, 3, 1),
        year: 2026,
        modus: "anteilig",
        einheit: "tag",
      });
      expect(r.factor).toBe(0);
    });
  });
});
