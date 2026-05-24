import { describe, expect, it } from "vitest";
import { ageInYear, isRoundBirthday } from "~/server/reports/birthday";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("isRoundBirthday", () => {
  it("flags 25 as round", () => {
    expect(isRoundBirthday(25)).toBe(true);
  });

  it("flags every 5th year from 50 upwards", () => {
    expect(isRoundBirthday(50)).toBe(true);
    expect(isRoundBirthday(55)).toBe(true);
    expect(isRoundBirthday(60)).toBe(true);
    expect(isRoundBirthday(75)).toBe(true);
    expect(isRoundBirthday(100)).toBe(true);
  });

  it("does not flag 30, 35, 40, 45", () => {
    expect(isRoundBirthday(30)).toBe(false);
    expect(isRoundBirthday(35)).toBe(false);
    expect(isRoundBirthday(40)).toBe(false);
    expect(isRoundBirthday(45)).toBe(false);
  });

  it("does not flag non-multiples of 5 above 50", () => {
    expect(isRoundBirthday(51)).toBe(false);
    expect(isRoundBirthday(67)).toBe(false);
    expect(isRoundBirthday(99)).toBe(false);
  });

  it("ignores negative or non-finite ages", () => {
    expect(isRoundBirthday(-5)).toBe(false);
    expect(isRoundBirthday(Number.NaN)).toBe(false);
  });
});

describe("ageInYear", () => {
  it("computes age based on year-of-birth only", () => {
    expect(ageInYear(utc(1975, 6, 15), 2025)).toBe(50);
  });

  it("returns the same value for any day in the chosen year", () => {
    expect(ageInYear(utc(2000, 1, 1), 2025)).toBe(25);
    expect(ageInYear(utc(2000, 12, 31), 2025)).toBe(25);
  });

  it("handles year transitions consistently", () => {
    expect(ageInYear(utc(1999, 12, 31), 2000)).toBe(1);
    expect(ageInYear(utc(2000, 1, 1), 2000)).toBe(0);
  });
});
