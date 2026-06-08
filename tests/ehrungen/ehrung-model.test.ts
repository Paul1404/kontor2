import { describe, expect, it } from "vitest";
import { jubilaeumTitel } from "~/lib/ehrungen";
import { resolveEhrungJahr, resolveEhrungTitel, yearOfIso } from "~/server/ehrungen/ehrung";
import { buildEhrungsurkundeModel, fmtUrkundeDate } from "~/server/pdf/ehrungsurkunde-model";

describe("ehrung helpers", () => {
  it("builds the standard Vereinsjubiläum title", () => {
    expect(jubilaeumTitel(25)).toBe("25 Jahre Mitgliedschaft");
    expect(jubilaeumTitel(50)).toBe("50 Jahre Mitgliedschaft");
  });

  it("falls back to the standard title for a Vereinsjubiläum with a blank title", () => {
    expect(resolveEhrungTitel("vereinsjubilaeum", "", 40)).toBe("40 Jahre Mitgliedschaft");
    expect(resolveEhrungTitel("vereinsjubilaeum", "  ", 40)).toBe("40 Jahre Mitgliedschaft");
  });

  it("keeps an explicit title over the fallback", () => {
    expect(resolveEhrungTitel("vereinsjubilaeum", "Ehrenmitglied", 40)).toBe("Ehrenmitglied");
  });

  it("requires a title for a Sonderehrung", () => {
    expect(resolveEhrungTitel("sonderehrung", "", null)).toBeNull();
    expect(resolveEhrungTitel("sonderehrung", "Goldene Ehrennadel", null)).toBe(
      "Goldene Ehrennadel",
    );
  });

  it("derives the honor year from the explicit value or the award date", () => {
    expect(resolveEhrungJahr(2025, "2025-03-15")).toBe(2025);
    // The explicit jubilee year wins even when it differs from the award date.
    expect(resolveEhrungJahr(2025, "2026-01-02")).toBe(2025);
    expect(resolveEhrungJahr(null, "2026-01-02")).toBe(2026);
    expect(yearOfIso("1999-12-31")).toBe(1999);
  });
});

describe("buildEhrungsurkundeModel", () => {
  const base = {
    vereinsname: "SV Untereuerheim 1945 e.V.",
    ort: "Untereuerheim",
    logoDataUri: null,
    empfaengerName: "Max Mustermann",
    verliehenAm: "2025-03-15",
    docRef: "EU-2025-0007",
  };

  it("formats ISO dates and passes other strings through", () => {
    expect(fmtUrkundeDate("2025-03-15")).toBe("15.03.2025");
    expect(fmtUrkundeDate("kein-datum")).toBe("kein-datum");
  });

  it("thanks the years of membership for a Vereinsjubiläum", () => {
    const m = buildEhrungsurkundeModel({
      ...base,
      kind: "vereinsjubilaeum",
      jubilaeumJahre: 25,
      titel: "25 Jahre Mitgliedschaft",
    });
    expect(m.ueberschrift).toBe("Ehrenurkunde");
    expect(m.verleihtZeile).toContain("SV Untereuerheim");
    expect(m.empfaengerName).toBe("Max Mustermann");
    expect(m.ehrungTitel).toBe("25 Jahre Mitgliedschaft");
    expect(m.wuerdigung).toContain("25 Jahre");
    expect(m.ortDatumZeile).toBe("Untereuerheim, den 15.03.2025");
  });

  it("honors merit for a Sonderehrung and drops the town when unset", () => {
    const m = buildEhrungsurkundeModel({
      ...base,
      ort: null,
      kind: "sonderehrung",
      jubilaeumJahre: null,
      titel: "Goldene Ehrennadel",
    });
    expect(m.ehrungTitel).toBe("Goldene Ehrennadel");
    expect(m.wuerdigung).toContain("besonderen Verdienste");
    expect(m.ortDatumZeile).toBe("15.03.2025");
  });
});
