import { describe, expect, it } from "vitest";
import { calculateFee, DEFAULT_BEITRAGSSTAFFEL } from "./fees";

describe("calculateFee (default schedule)", () => {
  it("familie is the flat tariff", () => {
    expect(calculateFee({ kategorie: "familie", elternteilMitglied: false }).betrag).toBe("96.00");
  });

  it("kind depends on whether a parent is a member", () => {
    expect(calculateFee({ kategorie: "kind", elternteilMitglied: true }).betrag).toBe("12.00");
    expect(calculateFee({ kategorie: "kind", elternteilMitglied: false }).betrag).toBe("24.00");
  });

  it("jugendlich depends on whether a parent is a member", () => {
    expect(calculateFee({ kategorie: "jugendlich", elternteilMitglied: true }).betrag).toBe(
      "24.00",
    );
    expect(calculateFee({ kategorie: "jugendlich", elternteilMitglied: false }).betrag).toBe(
      "36.00",
    );
  });

  it("junger_erwachsener and erwachsener ignore the parent flag", () => {
    expect(calculateFee({ kategorie: "junger_erwachsener", elternteilMitglied: true }).betrag).toBe(
      "42.00",
    );
    expect(calculateFee({ kategorie: "erwachsener", elternteilMitglied: false }).betrag).toBe(
      "54.00",
    );
  });

  it("honours a custom schedule from settings", () => {
    const staffel = { ...DEFAULT_BEITRAGSSTAFFEL, erwachsener: "60.00" };
    expect(
      calculateFee({ kategorie: "erwachsener", elternteilMitglied: false, staffel }).betrag,
    ).toBe("60.00");
  });

  it("returns a German label", () => {
    expect(calculateFee({ kategorie: "erwachsener", elternteilMitglied: false }).label).toBe(
      "Erwachsene",
    );
  });
});
