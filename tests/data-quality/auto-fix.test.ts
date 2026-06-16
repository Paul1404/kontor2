import { describe, expect, it } from "vitest";
import { AUTO_FIX_CATEGORIES, computeAutoFix } from "~/server/orpc/procedures/data-quality";

describe("computeAutoFix", () => {
  it("swaps a transposed name order and reports before/after", () => {
    // Stored swapped: vorname holds the surname, nachname holds the first name.
    const res = computeAutoFix("name_reihenfolge_vertauscht", {
      vorname: "Müller",
      nachname: "Hans",
    });
    expect(res).toEqual({
      patch: { vorname: "Hans", nachname: "Müller" },
      before: "Müller Hans",
      after: "Hans Müller",
    });
  });

  it("trims before swapping", () => {
    const res = computeAutoFix("name_reihenfolge_vertauscht", {
      vorname: "  Schmidt ",
      nachname: " Anna ",
    });
    expect("patch" in res && res.patch).toEqual({ vorname: "Anna", nachname: "Schmidt" });
  });

  it("refuses when a name field is missing rather than guessing", () => {
    expect(
      computeAutoFix("name_reihenfolge_vertauscht", { vorname: "Hans", nachname: null }),
    ).toEqual({ error: "Vor- und Nachname müssen beide gefüllt sein." });
    expect(
      computeAutoFix("name_reihenfolge_vertauscht", { vorname: "  ", nachname: "Müller" }),
    ).toEqual({ error: "Vor- und Nachname müssen beide gefüllt sein." });
  });

  it("returns an error for a category without an automatic fix", () => {
    const res = computeAutoFix("fehlende_iban", { vorname: "Hans", nachname: "Müller" });
    expect(res).toEqual({ error: "Für diese Prüfung gibt es keine automatische Korrektur." });
  });

  it("only advertises categories it can actually fix", () => {
    for (const c of AUTO_FIX_CATEGORIES) {
      const res = computeAutoFix(c, { vorname: "A", nachname: "B" });
      expect("patch" in res).toBe(true);
    }
  });
});
