export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

const NAME_RE = /^[a-zA-Z\u00C0-\u024F\s\-'.]+$/;
const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/i;

export function normalizeApplicationIban(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function validateIbanChecksum(value: string): boolean {
  const cleaned = normalizeApplicationIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  const expected = IBAN_LENGTHS[cleaned.slice(0, 2)];
  if (expected && cleaned.length !== expected) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function validateIbanMessage(value: string): string | null {
  const cleaned = normalizeApplicationIban(value);
  if (!cleaned) return "IBAN ist erforderlich.";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return "Ungültiges IBAN-Format.";
  const expected = IBAN_LENGTHS[cleaned.slice(0, 2)];
  if (expected && cleaned.length !== expected) {
    return `IBAN für ${cleaned.slice(0, 2)} muss ${expected} Zeichen haben.`;
  }
  if (cleaned.length < 15 || cleaned.length > 34) {
    return "IBAN muss zwischen 15 und 34 Zeichen haben.";
  }
  if (!validateIbanChecksum(cleaned)) return "IBAN-Prüfsumme ist ungültig.";
  return null;
}

export function validateBicMessage(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return BIC_RE.test(v) ? null : "Ungültiges BIC-Format.";
}

export function validateNameMessage(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return `${label} ist erforderlich.`;
  if (v.length < 2) return "Mindestens zwei Zeichen.";
  if (!NAME_RE.test(v)) return "Nur Buchstaben, Leerzeichen und Bindestriche.";
  return null;
}

export function validatePhoneMessage(value: string, optOut = false): string | null {
  const v = value.trim();
  if (!v) return optOut ? null : "Telefonnummer ist erforderlich oder bitte abwählen.";
  const cleaned = v.replace(/[\s\-/()]/g, "");
  return /^\+?\d{6,15}$/.test(cleaned) ? null : "Ungültige Telefonnummer.";
}

export function validatePlzMessage(value: string): string | null {
  const v = value.trim();
  if (!v) return "PLZ ist erforderlich.";
  return /^\d{5}$/.test(v) ? null : "PLZ muss 5 Ziffern haben.";
}

export function validatePastDateMessage(value: string, label: string, opts?: { maxAge?: number }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} ist erforderlich.`;
  const d = parseLocalDate(value);
  if (!d) return `${label} ist ungültig.`;
  const today = startOfToday();
  if (d >= today) return `${label} muss in der Vergangenheit liegen.`;
  const age = realAgeFromIso(value);
  if (opts?.maxAge != null && age != null && age > opts.maxAge) return `${label} ist ungültig.`;
  return null;
}

export function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null;
  }
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function realAgeFromIso(value: string, today = new Date()): number | null {
  const birth = parseLocalDate(value);
  if (!birth) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
