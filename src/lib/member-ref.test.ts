import { describe, expect, it } from "vitest";
import { altMitgliedsnummer, memberRef } from "./member-ref";

describe("memberRef", () => {
  it("prefers the app-owned member number", () => {
    expect(memberRef({ memberNo: "M-100", mitgliedsnummer: "42", adrNr: 7 })).toBe("M-100");
  });

  it("falls back to the contact number, then the legacy number, then the adrNr", () => {
    expect(memberRef({ kontaktNo: "K-5", mitgliedsnummer: "42" })).toBe("K-5");
    expect(memberRef({ mitgliedsnummer: "42", adrNr: 7 })).toBe("42");
    expect(memberRef({ adrNr: 7 })).toBe("A7");
  });
});

describe("altMitgliedsnummer", () => {
  it("returns the trimmed legacy number when it differs from the shown reference", () => {
    expect(altMitgliedsnummer("42", "M-100")).toBe("42");
    expect(altMitgliedsnummer("  42 ", "M-100")).toBe("42");
  });

  it("suppresses the legacy number when it already equals the shown reference", () => {
    // A member without an app number: memberRef already prints the legacy value,
    // so the "(alt)" line would only duplicate it.
    expect(altMitgliedsnummer("42", "42")).toBeNull();
    expect(altMitgliedsnummer(" 42 ", "42")).toBeNull();
  });

  it("returns null when there is no legacy number", () => {
    expect(altMitgliedsnummer(null, "M-100")).toBeNull();
    expect(altMitgliedsnummer(undefined, "M-100")).toBeNull();
    expect(altMitgliedsnummer("   ", "M-100")).toBeNull();
  });

  it("returns the legacy number when no primary reference is shown (empty ref)", () => {
    // The Ehrungsurkunde prints no primary number, so the legacy value always
    // shows when present.
    expect(altMitgliedsnummer("42", "")).toBe("42");
    expect(altMitgliedsnummer(null, "")).toBeNull();
  });
});
