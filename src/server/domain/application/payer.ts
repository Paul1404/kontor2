/**
 * Decide whether an application's Kontoinhaber differs from the member who will
 * own the SEPA mandate, so the divergent account holder can be recorded on the
 * contract (and member). The fee run prints `contract.abwKontoInh` as the SEPA
 * debtor name for self-payers, so without this a third-party account would be
 * debited under the member's own name.
 *
 * Pure and unit-testable: no DB, no IO.
 */

/** Lower-case, collapse whitespace, trim. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Returns the Kontoinhaber to store as the divergent account holder, or null
 * when it is empty or simply the member's own name (the common case, where the
 * member name is the debtor and no override is needed).
 */
export function divergentKontoinhaber(
  kontoinhaber: string | null | undefined,
  vorname: string | null | undefined,
  nachname: string | null | undefined,
): string | null {
  const holder = kontoinhaber?.trim();
  if (!holder) return null;
  const memberName = `${vorname ?? ""} ${nachname ?? ""}`;
  return normalize(holder) === normalize(memberName) ? null : holder;
}
