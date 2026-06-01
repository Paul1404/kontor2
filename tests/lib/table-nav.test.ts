import { describe, expect, it } from "vitest";
import { clampCursor, moveCursor } from "~/lib/table-nav";

describe("clampCursor", () => {
  it("returns -1 for an empty list", () => {
    expect(clampCursor(0, 0)).toBe(-1);
    expect(clampCursor(3, 0)).toBe(-1);
  });

  it("clamps below zero to the first row", () => {
    expect(clampCursor(-5, 10)).toBe(0);
  });

  it("clamps past the end to the last row", () => {
    expect(clampCursor(99, 10)).toBe(9);
  });

  it("passes through an in-range index", () => {
    expect(clampCursor(4, 10)).toBe(4);
  });
});

describe("moveCursor", () => {
  it("lands on the first row when moving down from no cursor", () => {
    expect(moveCursor(-1, 1, 5)).toBe(0);
  });

  it("lands on the last row when moving up from no cursor", () => {
    expect(moveCursor(-1, -1, 5)).toBe(4);
  });

  it("moves within bounds", () => {
    expect(moveCursor(2, 1, 5)).toBe(3);
    expect(moveCursor(2, -1, 5)).toBe(1);
  });

  it("does not wrap past the ends", () => {
    expect(moveCursor(4, 1, 5)).toBe(4);
    expect(moveCursor(0, -1, 5)).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(moveCursor(0, 1, 0)).toBe(-1);
  });
});
