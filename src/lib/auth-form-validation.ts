export function validateRequiredEmail(value: string): string | undefined {
  return value.trim() ? undefined : "Bitte geben Sie Ihre E-Mail-Adresse ein.";
}

export function validateRequiredPassword(value: string): string | undefined {
  return value ? undefined : "Bitte geben Sie Ihr Passwort ein.";
}

export function validateNewPassword(value: string): string | undefined {
  return value.length >= 12 ? undefined : "Das Passwort muss mindestens 12 Zeichen haben.";
}

export function validatePasswordConfirmation(
  confirmation: string,
  password: string,
): string | undefined {
  return !confirmation || confirmation === password
    ? undefined
    : "Die beiden Passwörter stimmen nicht überein.";
}
