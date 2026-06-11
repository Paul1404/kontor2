import { describe, expect, it } from "vitest";
import { familienNameVorschlag, rolleVorschlag } from "~/server/domain/familie";

const asOf = new Date("2026-06-11T12:00:00Z");

describe("rolleVorschlag", () => {
  it("schlägt Kind vor, solange jemand unter 18 ist", () => {
    expect(rolleVorschlag(new Date("2010-01-01"), asOf)).toBe("kind");
    // 18. Geburtstag morgen: heute noch 17 -> Kind.
    expect(rolleVorschlag(new Date("2008-06-12"), asOf)).toBe("kind");
  });

  it("schlägt Partner ab dem 18. Geburtstag vor", () => {
    expect(rolleVorschlag(new Date("2008-06-11"), asOf)).toBe("partner");
    expect(rolleVorschlag(new Date("1990-03-15"), asOf)).toBe("partner");
  });

  it("fällt ohne Geburtsdatum auf Partner zurück", () => {
    expect(rolleVorschlag(null, asOf)).toBe("partner");
  });
});

describe("familienNameVorschlag", () => {
  it("baut den Namen aus dem Nachnamen", () => {
    expect(familienNameVorschlag("Brückner")).toBe("Familie Brückner");
  });

  it("fällt ohne Nachnamen auf Familie zurück", () => {
    expect(familienNameVorschlag(null)).toBe("Familie");
    expect(familienNameVorschlag("  ")).toBe("Familie");
  });
});
