/**
 * IBAN validation per ISO 13616: mod-97 check after letter-to-digit
 * substitution. Length is enforced against the per-country table.
 */

// Country -> expected IBAN length. Covers SEPA + a few common non-SEPA.
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22,
  BR: 29, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27,
  GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IS: 26, IT: 27, JO: 30, KW: 30,
  KZ: 20, LB: 28, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22,
  MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29,
  PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  TN: 24, TR: 26, VA: 22, VG: 24,
};

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function validateIban(value: string | null | undefined): boolean {
  if (!value) return false;
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTH[country];
  if (expected != null && iban.length !== expected) return false;
  // Rotate first 4 chars to the end, then convert letters: A=10..Z=35.
  const rotated = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rotated) {
    const code = ch.charCodeAt(0);
    const digit = code >= 65 ? code - 55 : code - 48;
    // 9-digit chunked modular arithmetic to keep numbers in safe integer range.
    remainder = (remainder * (digit >= 10 ? 100 : 10) + digit) % 97;
  }
  return remainder === 1;
}

export function formatIbanGrouped(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}
