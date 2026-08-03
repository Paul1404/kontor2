import { describe, expect, it } from "vitest";
import {
  validateNewPassword,
  validatePasswordConfirmation,
  validateRequiredEmail,
  validateRequiredPassword,
} from "../../src/lib/auth-form-validation";

describe("auth form validation", () => {
  it("requires a non-empty email address", () => {
    expect(validateRequiredEmail("  ")).toBe("Bitte geben Sie Ihre E-Mail-Adresse ein.");
    expect(validateRequiredEmail("user@example.test")).toBeUndefined();
  });

  it("requires the current password", () => {
    expect(validateRequiredPassword("")).toBe("Bitte geben Sie Ihr Passwort ein.");
    expect(validateRequiredPassword("secret")).toBeUndefined();
  });

  it("enforces the minimum length for a new password", () => {
    expect(validateNewPassword("short")).toBe("Das Passwort muss mindestens 12 Zeichen haben.");
    expect(validateNewPassword("long-enough-password")).toBeUndefined();
  });

  it("accepts an empty confirmation until the user starts typing", () => {
    expect(validatePasswordConfirmation("", "long-enough-password")).toBeUndefined();
    expect(validatePasswordConfirmation("different", "long-enough-password")).toBe(
      "Die beiden Passwörter stimmen nicht überein.",
    );
    expect(
      validatePasswordConfirmation("long-enough-password", "long-enough-password"),
    ).toBeUndefined();
  });
});
