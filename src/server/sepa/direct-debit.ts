/**
 * Normalizes Linear Webverein's "does this contract pay by SEPA direct debit?"
 * quirk into a single boolean.
 *
 * Linear leaves `mgvert.Lastschrift` blank for the common direct-debit case and
 * only populates it to flag exceptions, so a null/empty value must count as
 * direct debit -- not as "unknown". Explicit invoice payers carry
 * `AufRechnung = 'J'` and are never debited.
 *
 * Rules:
 * - `aufRechnung = 'J'` (any case) -> invoice payer -> NOT direct debit.
 * - otherwise: direct debit unless `lastschrift` is explicitly set to a
 *   non-"J" value (e.g. "N").
 *
 * This is the single place the Linear quirk is interpreted. It runs once, at
 * import time, to populate `contracts.is_direct_debit`; runtime code reads that
 * boolean column and never reinterprets `lastschrift`/`aufRechnung` again.
 */
export function paysByDirectDebit(
  lastschrift: string | null | undefined,
  aufRechnung: string | null | undefined,
): boolean {
  if ((aufRechnung ?? "").trim().toUpperCase() === "J") return false;
  const ls = (lastschrift ?? "").trim().toUpperCase();
  return ls === "" || ls === "J";
}
