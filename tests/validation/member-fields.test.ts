import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  normalizePhone,
  summarizeBatch,
  titleCaseName,
  validateBic,
  validateEmail,
  validateGeburtsdatum,
  validateIbanField,
  validatePhone,
  validatePlz,
} from "~/server/validation/member-fields";

describe("member field validators", () => {
  it("validateEmail rejects comma-instead-of-dot and missing @", () => {
    expect(validateEmail("user@web.de").level).toBe("ok");
    expect(validateEmail("user@web,de").level).toBe("error");
    expect(validateEmail("userweb.de").level).toBe("error");
    expect(validateEmail("user@webde").level).toBe("error");
    // Absence is not an error here.
    expect(validateEmail(null).level).toBe("ok");
    expect(validateEmail("  ").level).toBe("ok");
  });

  it("validateIbanField checks the mod-97 checksum", () => {
    expect(validateIbanField("DE89370400440532013000").level).toBe("ok");
    expect(validateIbanField("DE89 3704 0044 0532 0130 00").level).toBe("ok");
    expect(validateIbanField("DE89370400440532013001").level).toBe("error");
    expect(validateIbanField(null).level).toBe("ok");
  });

  it("validateBic accepts 8 or 11 chars only", () => {
    expect(validateBic("COBADEFF").level).toBe("ok");
    expect(validateBic("COBADEFFXXX").level).toBe("ok");
    expect(validateBic("cobadeffxxx").level).toBe("ok"); // case-insensitive
    expect(validateBic("COBADE").level).toBe("error");
    expect(validateBic("COBADEFFXX").level).toBe("error"); // 10 chars
    expect(validateBic("1OBADEFF").level).toBe("error"); // bank code must be letters
  });

  it("validatePlz requires 5 digits for domestic and cross-checks Ort", () => {
    expect(validatePlz("97461", { land: "DE" }).level).toBe("ok");
    expect(validatePlz("974", { land: "DE" }).level).toBe("error");
    expect(validatePlz("974", { land: "" }).level).toBe("error"); // default domestic
    expect(validatePlz("ABCDE", { land: "DE" }).level).toBe("error");
    // Foreign PLZ is not held to the 5-digit rule.
    expect(validatePlz("1010", { land: "Österreich" }).level).toBe("ok");
    // Ort cross-check is a warning, not an error.
    expect(
      validatePlz("97461", { land: "DE", expectedOrt: "Untereuerheim", actualOrt: "Berlin" }).level,
    ).toBe("warning");
  });

  it("validatePhone rejects area-code-only numbers", () => {
    expect(validatePhone("09521").level).toBe("error"); // 5 digits, no subscriber
    expect(validatePhone("0952").level).toBe("error");
    expect(validatePhone("09521 123456").level).toBe("ok");
    expect(validatePhone("+49 9521 123456").level).toBe("ok");
    expect(validatePhone(null).level).toBe("ok");
  });

  it("validateGeburtsdatum rejects future dates and impossible ages", () => {
    expect(validateGeburtsdatum("1990-01-01").level).toBe("ok");
    const future = new Date(Date.now() + 86_400_000);
    expect(validateGeburtsdatum(future).level).toBe("error");
    expect(validateGeburtsdatum("1850-01-01").level).toBe("error"); // age > 110
    expect(validateGeburtsdatum(null).level).toBe("ok");
  });
});

describe("member field normalizers", () => {
  it("collapseWhitespace trims and folds runs, empty -> null", () => {
    expect(collapseWhitespace("  Müller   Lüdenscheidt ")).toBe("Müller Lüdenscheidt");
    expect(collapseWhitespace("   ")).toBeNull();
    expect(collapseWhitespace(null)).toBeNull();
  });

  it("titleCaseName re-cases all-upper/all-lower but keeps mixed case", () => {
    expect(titleCaseName("MÜLLER")).toBe("Müller");
    expect(titleCaseName("müller")).toBe("Müller");
    expect(titleCaseName("hans-peter")).toBe("Hans-Peter");
    // Deliberate mixed case is preserved.
    expect(titleCaseName("McDonald")).toBe("McDonald");
    expect(titleCaseName("von der Heide")).toBe("von der Heide");
  });

  it("normalizePhone coerces an area-code-only value to null", () => {
    expect(normalizePhone("09521")).toBeNull();
    expect(normalizePhone(" 09521  123456 ")).toBe("09521 123456");
  });
});

describe("summarizeBatch", () => {
  it("counts per-field issues and duplicate Mitgliedsnummern", () => {
    const report = summarizeBatch([
      { mitgliedsnummer: "1272", email: "a@b,de", iban1: "DE89370400440532013001" },
      { mitgliedsnummer: "1272", bic1: "BAD" },
      { mitgliedsnummer: "0001", plz: "974", land: "DE" },
      { mitgliedsnummer: "0002" }, // clean
    ]);
    expect(report.total).toBe(4);
    expect(report.flaggedRecords).toBe(3);
    expect(report.errors).toBe(4); // email + iban + bic + plz
    expect(report.byField.email?.error).toBe(1);
    expect(report.byField.iban1?.error).toBe(1);
    expect(report.byField.bic1?.error).toBe(1);
    expect(report.byField.plz?.error).toBe(1);
    expect(report.duplicateMitgliedsnummern).toEqual(["1272"]);
  });
});
