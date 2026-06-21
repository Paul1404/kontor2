import data from "~/server/lib/data/blz-de.json" with { type: "json" };

type BlzEntry = { name: string; bic: string };

const DE_BLZ = data as Record<string, BlzEntry>;

/**
 * Extract the bank code (BLZ for DE) from an IBAN. Returns null if the
 * country is not yet supported by our dataset.
 */
export function extractBankCode(iban: string): { country: string; bankCode: string } | null {
  const clean = iban.replace(/\s+/g, "").toUpperCase();
  if (clean.length < 8) return null;
  const country = clean.slice(0, 2);
  // BLZ is 8 digits for DE IBANs (positions 4..12).
  if (country === "DE") return { country, bankCode: clean.slice(4, 12) };
  return null;
}

/**
 * Look up the bank name + BIC for a given IBAN against the bundled
 * Deutsche Bundesbank dataset. Returns null when the IBAN's country is
 * not DE or the BLZ is unknown.
 */
export function lookupBankByIban(iban: string | null | undefined): BlzEntry | null {
  if (!iban) return null;
  const extracted = extractBankCode(iban);
  if (extracted?.country !== "DE") return null;
  return DE_BLZ[extracted.bankCode] ?? null;
}

/**
 * Look up by raw BLZ string. Used when an IBAN is not available (e.g. only
 * the historical BLZ column is populated on imported records).
 */
export function lookupBankByBlz(blz: string | null | undefined): BlzEntry | null {
  if (!blz) return null;
  const padded = blz.replace(/\D/g, "").padStart(8, "0").slice(-8);
  return DE_BLZ[padded] ?? null;
}
