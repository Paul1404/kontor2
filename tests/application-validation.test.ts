import { describe, expect, it } from "vitest";
import {
  realAgeFromIso,
  validateBicMessage,
  validateIbanChecksum,
  validateIbanMessage,
  validateNameMessage,
  validatePhoneMessage,
  validatePlzMessage,
} from "~/lib/application-validation";

describe("application validation helpers", () => {
  it("validates IBAN checksum and country length", () => {
    expect(validateIbanChecksum("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(validateIbanMessage("DE89 3704 0044 0532 0130 01")).toBe("IBAN-Prüfsumme ist ungültig.");
    expect(validateIbanMessage("DE89")).toBe("Ungültiges IBAN-Format.");
  });

  it("validates BIC, PLZ, phone and names like the application form", () => {
    expect(validateBicMessage("BYLADEM1001")).toBeNull();
    expect(validateBicMessage("bad")).toBe("Ungültiges BIC-Format.");
    expect(validatePlzMessage("97508")).toBeNull();
    expect(validatePlzMessage("9750")).toBe("PLZ muss 5 Ziffern haben.");
    expect(validatePhoneMessage("09727 123456", false)).toBeNull();
    expect(validatePhoneMessage("", true)).toBeNull();
    expect(validatePhoneMessage("", false)).toBe(
      "Telefonnummer ist erforderlich oder bitte abwählen.",
    );
    expect(validateNameMessage("Müller-Lüdenscheid", "Nachname")).toBeNull();
    expect(validateNameMessage("M", "Nachname")).toBe("Mindestens zwei Zeichen.");
  });

  it("computes real age from ISO dates", () => {
    expect(realAgeFromIso("2000-06-01", new Date(2026, 0, 1))).toBe(25);
    expect(realAgeFromIso("2000-01-01", new Date(2026, 0, 1))).toBe(26);
  });
});
