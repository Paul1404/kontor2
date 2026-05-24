import { describe, expect, it } from "vitest";
import { slugify, splitAbteilung } from "~/server/importer/abteilung-splitter";

describe("splitAbteilung", () => {
  it("splits on comma, slash, semicolon, pipe", () => {
    expect(splitAbteilung("Fußball, Handball / Turnen; Schach | Tennis")).toEqual([
      "Fußball",
      "Handball",
      "Turnen",
      "Schach",
      "Tennis",
    ]);
  });
  it("deduplicates case-insensitively", () => {
    expect(splitAbteilung("Fußball, fussBALL")).toHaveLength(2);
    expect(splitAbteilung("Fußball, Fußball")).toEqual(["Fußball"]);
  });
  it("returns [] for empty / null", () => {
    expect(splitAbteilung(null)).toEqual([]);
    expect(splitAbteilung("")).toEqual([]);
    expect(splitAbteilung("   ")).toEqual([]);
  });
});

describe("slugify", () => {
  it("strips diacritics and lowercases", () => {
    expect(slugify("Fußball Männer")).toBe("fussball-manner");
    expect(slugify("Tennis Jugend")).toBe("tennis-jugend");
  });
});
