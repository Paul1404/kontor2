import { describe, expect, it } from "vitest";
import { isKeineAbteilung, KEINE_ABTEILUNG_NAME } from "./abteilung-filter";

describe("isKeineAbteilung", () => {
  it("matches the common Linear spellings of the no-department sentinel", () => {
    for (const name of [
      "Keine-Abteilung",
      "keine abteilung",
      "KeineAbteilung",
      "  Keine Abteilung  ",
      "KEINE-ABTEILUNG",
    ]) {
      expect(isKeineAbteilung(name)).toBe(true);
    }
  });

  it("does not match real department names", () => {
    for (const name of ["Fußball", "Turnen", "Förderkreis", "Abteilung Tennis"]) {
      expect(isKeineAbteilung(name)).toBe(false);
    }
  });

  it("treats the canonical name itself as the sentinel", () => {
    expect(isKeineAbteilung(KEINE_ABTEILUNG_NAME)).toBe(true);
  });
});
