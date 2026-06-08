import { describe, expect, it } from "vitest";
import { deriveGeschlecht } from "~/server/domain/member";

describe("deriveGeschlecht", () => {
  it("maps clear male Anreden to 'm'", () => {
    for (const a of ["Herr", "herr", " HERR ", "Hr", "Hr.", "Herrn", "Herr Dr.", "Herr Prof."]) {
      expect(deriveGeschlecht(a)).toBe("m");
    }
  });

  it("maps clear female Anreden to 'w'", () => {
    for (const a of ["Frau", "frau", " FRAU ", "Fr", "Fr.", "Frau Dr."]) {
      expect(deriveGeschlecht(a)).toBe("w");
    }
  });

  it("maps an explicit Divers Anrede to 'd'", () => {
    expect(deriveGeschlecht("Divers")).toBe("d");
  });

  it("returns null for ambiguous, company, or empty Anreden", () => {
    for (const a of ["", "   ", null, undefined, "Familie", "Firma", "Dr.", "Eheleute"]) {
      expect(deriveGeschlecht(a)).toBeNull();
    }
  });
});
