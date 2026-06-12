/**
 * Normalizes Linear Webverein's "does this contract pay by SEPA direct debit?"
 * quirk into a single boolean.
 *
 * The one and only invoice marker is `AufRechnung = 'J'`; everything else pays
 * by direct debit. Linear's `mgvert.Lastschrift` is NOT a reliable opposite
 * signal: it is blank for the common case but also carries codes like `'L'`
 * (= Lastschrift) and `'B'`, all of which still mean direct debit. An earlier
 * version treated any non-blank, non-"J" `lastschrift` as "not direct debit",
 * which wrongly flagged every `'L'` contract as an invoice payer (Zahlart-Kachel
 * zeigte "Rechnung", obwohl der Verein keine Rechnung anbietet; siehe die 0055
 * Backfill-Migration).
 *
 * This is the single place the Linear quirk is interpreted. It runs once, at
 * import time, to populate `contracts.is_direct_debit`; runtime code reads that
 * boolean column and never reinterprets `lastschrift`/`aufRechnung` again.
 *
 * @param _lastschrift kept for call-site compatibility; intentionally unused.
 */
export function paysByDirectDebit(
  _lastschrift: string | null | undefined,
  aufRechnung: string | null | undefined,
): boolean {
  return (aufRechnung ?? "").trim().toUpperCase() !== "J";
}
