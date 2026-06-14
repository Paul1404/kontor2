import { describe, expect, it } from "vitest";
import { calculateFee, DEFAULT_BEITRAGSSTAFFEL } from "~/server/domain/application/fees";

// `staffel` is required now (no hardcoded fallback), so these pass the historic
// SVU schedule explicitly to assert the per-category mapping.
const staffel = DEFAULT_BEITRAGSSTAFFEL;

describe("calculateFee (mapping over a schedule)", () => {
  it("familie is the flat tariff", () => {
    expect(calculateFee({ kategorie: "familie", elternteilMitglied: false, staffel }).betrag).toBe(
      "96.00",
    );
  });

  it("kind depends on whether a parent is a member", () => {
    expect(calculateFee({ kategorie: "kind", elternteilMitglied: true, staffel }).betrag).toBe(
      "12.00",
    );
    expect(calculateFee({ kategorie: "kind", elternteilMitglied: false, staffel }).betrag).toBe(
      "24.00",
    );
  });

  it("jugendlich depends on whether a parent is a member", () => {
    expect(
      calculateFee({ kategorie: "jugendlich", elternteilMitglied: true, staffel }).betrag,
    ).toBe("24.00");
    expect(
      calculateFee({ kategorie: "jugendlich", elternteilMitglied: false, staffel }).betrag,
    ).toBe("36.00");
  });

  it("junger_erwachsener and erwachsener ignore the parent flag", () => {
    expect(
      calculateFee({ kategorie: "junger_erwachsener", elternteilMitglied: true, staffel }).betrag,
    ).toBe("42.00");
    expect(
      calculateFee({ kategorie: "erwachsener", elternteilMitglied: false, staffel }).betrag,
    ).toBe("54.00");
  });

  it("honours a custom schedule from settings", () => {
    const custom = { ...DEFAULT_BEITRAGSSTAFFEL, erwachsener: "60.00" };
    expect(
      calculateFee({ kategorie: "erwachsener", elternteilMitglied: false, staffel: custom }).betrag,
    ).toBe("60.00");
  });

  it("returns a German label", () => {
    expect(
      calculateFee({ kategorie: "erwachsener", elternteilMitglied: false, staffel }).label,
    ).toBe("Erwachsene");
  });
});
