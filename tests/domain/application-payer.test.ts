import { describe, expect, it } from "vitest";
import { divergentKontoinhaber } from "~/server/domain/application/payer";

describe("divergentKontoinhaber", () => {
  it("returns null when the account holder is the member's own name", () => {
    expect(divergentKontoinhaber("Max Mustermann", "Max", "Mustermann")).toBeNull();
  });

  it("ignores case and extra whitespace when comparing", () => {
    expect(divergentKontoinhaber("  max   MUSTERMANN ", "Max", "Mustermann")).toBeNull();
  });

  it("returns the holder when it differs from the member", () => {
    expect(divergentKontoinhaber("Erika Mustermann", "Max", "Mustermann")).toBe("Erika Mustermann");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(divergentKontoinhaber("", "Max", "Mustermann")).toBeNull();
    expect(divergentKontoinhaber("   ", "Max", "Mustermann")).toBeNull();
    expect(divergentKontoinhaber(null, "Max", "Mustermann")).toBeNull();
    expect(divergentKontoinhaber(undefined, "Max", "Mustermann")).toBeNull();
  });

  it("treats a holder as divergent when the member has no name on file", () => {
    expect(divergentKontoinhaber("Erika Mustermann", null, null)).toBe("Erika Mustermann");
  });
});
