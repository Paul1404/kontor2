/**
 * Wiedereinzug (re-collection) of returned direct debits.
 *
 * When a SEPA debit comes back (Rücklastschrift), the Sollstellung is reopened
 * to status `returned`. The Beitragslauf will never pick it up again -- it
 * excludes any non-cancelled posting for the year as "already billed". So a
 * returned posting has no path back into a new pain.008 on its own.
 *
 * A recollection run closes that gap: the operator corrects the IBAN / adds a
 * fresh mandate, then re-debits the selected returned postings in a new
 * pain.008. This module holds the pure eligibility rule; the query and the
 * commit live in the fee-runs procedures so all DB access stays in one place.
 */

export type RecollectionBlockReason =
  | "Einzug ausgesetzt"
  | "Lastschrift nicht aktiv"
  | "Kein aktives SEPA-Mandat"
  | "Keine IBAN hinterlegt";

/**
 * Why a returned posting cannot be re-collected, or null when it can. Checked
 * in priority order so the surfaced reason is the one the operator should fix
 * first: an explicit direct-debit hold, then a contract switched to invoice,
 * then the missing mandate, then the missing IBAN. Kept pure so the cascade is
 * unit-testable without a database.
 */
export function recollectionBlockReason(opts: {
  directDebitBlocked: boolean;
  isDirectDebit: boolean;
  hasMandate: boolean;
  hasIban: boolean;
}): RecollectionBlockReason | null {
  if (opts.directDebitBlocked) return "Einzug ausgesetzt";
  if (!opts.isDirectDebit) return "Lastschrift nicht aktiv";
  if (!opts.hasMandate) return "Kein aktives SEPA-Mandat";
  if (!opts.hasIban) return "Keine IBAN hinterlegt";
  return null;
}
