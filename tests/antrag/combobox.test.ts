import { describe, expect, it } from "vitest";
import {
  isComboboxNavKey,
  looksLikeHausnummer,
  moveActiveOption,
  splitMatch,
} from "../../src/lib/antrag-combobox";

describe("moveActiveOption", () => {
  it("starts at the top on ArrowDown and at the bottom on ArrowUp", () => {
    expect(moveActiveOption(null, 3, "ArrowDown")).toBe(0);
    expect(moveActiveOption(null, 3, "ArrowUp")).toBe(2);
  });
  it("wraps around at both ends", () => {
    expect(moveActiveOption(2, 3, "ArrowDown")).toBe(0);
    expect(moveActiveOption(0, 3, "ArrowUp")).toBe(2);
  });
  it("steps within the list and honours Home/End", () => {
    expect(moveActiveOption(0, 3, "ArrowDown")).toBe(1);
    expect(moveActiveOption(2, 3, "ArrowUp")).toBe(1);
    expect(moveActiveOption(1, 3, "Home")).toBe(0);
    expect(moveActiveOption(1, 3, "End")).toBe(2);
  });
  it("yields nothing for an empty list", () => {
    expect(moveActiveOption(1, 0, "ArrowDown")).toBeNull();
  });
  it("recognises navigation keys only", () => {
    expect(isComboboxNavKey("ArrowDown")).toBe(true);
    expect(isComboboxNavKey("Enter")).toBe(false);
  });
});

describe("splitMatch", () => {
  it("highlights the typed prefix case-insensitively", () => {
    expect(splitMatch("Grettstadter Str.", "grett")).toEqual([
      { text: "Grett", hit: true },
      { text: "stadter Str.", hit: false },
    ]);
  });
  it("highlights a match in the middle", () => {
    expect(splitMatch("Am Sportplatz", "sport")).toEqual([
      { text: "Am ", hit: false },
      { text: "Sport", hit: true },
      { text: "platz", hit: false },
    ]);
  });
  it("matches across diacritics and sharp s", () => {
    expect(splitMatch("Hauptstraße", "strasse")).toEqual([
      { text: "Haupt", hit: false },
      { text: "straße", hit: true },
    ]);
    expect(splitMatch("Rüdigerweg", "rud")).toEqual([
      { text: "Rüd", hit: true },
      { text: "igerweg", hit: false },
    ]);
  });
  it("returns the plain text when nothing matches or the query is empty", () => {
    expect(splitMatch("Bahnhofstraße", "xyz")).toEqual([{ text: "Bahnhofstraße", hit: false }]);
    expect(splitMatch("Bahnhofstraße", "  ")).toEqual([{ text: "Bahnhofstraße", hit: false }]);
  });
});

describe("looksLikeHausnummer", () => {
  it("accepts common German house numbers", () => {
    for (const v of ["12", "12a", "3-5", "7 b", "1/2"]) expect(looksLikeHausnummer(v)).toBe(true);
  });
  it("rejects empty or digit-free values", () => {
    for (const v of ["", "  ", "Haus", "abc"]) expect(looksLikeHausnummer(v)).toBe(false);
  });
});
