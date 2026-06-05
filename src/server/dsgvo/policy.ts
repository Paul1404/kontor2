/**
 * DSGVO erasure policy. Single source of truth for which member columns are
 * considered "personally identifying" (and therefore scrubbed on erasure)
 * vs. "financial / retention-required" (and therefore preserved until the
 * retention period expires).
 *
 * Retention periods (Germany):
 *   - HGB §257: 6 Jahre (Handelsbriefe, Geschäftsbriefe)
 *   - AO §147 / GoBD: 10 Jahre (Buchungsbelege, Steuerunterlagen)
 *   - BGB §195/199: 3 Jahre regelmäßige Verjährung
 *   - SEPA Rulebook: Mandat 14 Monate nach letzter Verwendung
 *
 * Practical rule: a member may be erased no earlier than 10 full years after
 * the last financial event (Beitrag / SEPA mandate use). Override is allowed
 * with a documented reason — the audit log captures both.
 */

export const RETENTION_YEARS = {
  /** Financial records per AO/GoBD — the strictest German retention period. */
  financial: 10,
  /** Commercial correspondence per HGB. */
  commercial: 6,
  /** SEPA mandate retention after last use (14 months). */
  sepaMandateMonths: 14,
} as const;

/**
 * Member columns whose plaintext values must be cleared during pseudonymization.
 * Anything not listed here is preserved as-is so financial linkage stays intact.
 *
 * Values map to the replacement: `null` clears the field, a string is the
 * pseudonym to write. Pseudonyms are used where a NOT NULL constraint or
 * downstream join would otherwise break.
 */
export type ErasureScrubRule = { kind: "null" } | { kind: "pseudonym"; value: string };

/**
 * Lookup of every members column we touch during erasure.
 * `pseudonym` values are intentionally generic — they should not encode
 * personally identifying hints (no initials, no birth year).
 */
export function buildScrubRules(memberId: string): Record<string, ErasureScrubRule> {
  const tag = memberId.slice(0, 8);
  return {
    // Names
    vorname: { kind: "pseudonym", value: `Anonym-${tag}` },
    nachname: { kind: "pseudonym", value: "(gelöscht)" },
    kurzname: { kind: "null" },
    geborene: { kind: "null" },
    geburtsname: { kind: "null" },
    genannt: { kind: "null" },
    namensvorsatz: { kind: "null" },
    namenszusatz: { kind: "null" },
    anrede: { kind: "null" },
    titel1: { kind: "null" },
    titel2: { kind: "null" },
    // Address
    strasse: { kind: "null" },
    hausnummer: { kind: "null" },
    plz: { kind: "null" },
    ort: { kind: "null" },
    landname: { kind: "null" },
    adresszusatz: { kind: "null" },
    haus: { kind: "null" },
    // Alternative postal addresses
    strasseKih: { kind: "null" },
    plzKih: { kind: "null" },
    ortKih: { kind: "null" },
    // Contact
    eMailName: { kind: "null" },
    email: { kind: "null" }, // clean column, mirrors eMailName
    emailKih: { kind: "null" },
    telefon1: { kind: "null" },
    telefon2: { kind: "null" },
    telefon3: { kind: "null" },
    fax: { kind: "null" },
    www: { kind: "null" },
    // Demographics
    geburtsdatum: { kind: "null" },
    geburtsort: { kind: "null" },
    // Bank details — full plaintext IBAN is scrubbed; `iban1Last4` is kept
    // for SEPA mandate retention / R-transaction reconciliation per Rulebook.
    iban1: { kind: "null" },
    iban2: { kind: "null" },
    iban3: { kind: "null" },
    bic1: { kind: "null" },
    bank1: { kind: "null" },
    bank: { kind: "null" },
    blz: { kind: "null" },
    // Cards
    // Identity documents
    // Free text / notes that may contain personal narrative
    notes: { kind: "null" },
  };
}

/**
 * Member columns that are explicitly KEPT during erasure because they are
 * required by retention rules. Documented here as code so a future change
 * to the policy must be a code review, not a data-edit. The list is not
 * enforced anywhere — it exists as an inventory.
 */
export const RETAINED_COLUMNS = [
  "id",
  "adrNr", // legacy linkage to Linear / SVUMS
  "mitglnr", // human-readable membership number — needed for fee history reconciliation
  "mitgliedsnummer", // clean column, mirrors mitglnr
  "status", // clean lifecycle status — not identifying
  "dunningBlocked", // clean dunning flag — not identifying
  "createdAt",
  "updatedAt",
  "deletedAt",
  "eintritt",
  "austritt",
  "verstorbenAm",
  "aktivPasiv",
  "aktiv",
  "geschlecht", // statistically aggregated (Bestandserhebung) — not identifying on its own
  "iban1Last4", // SEPA retention (14 mo after last use), masked already
  "mandatsrefenz",
  "lastImportedAt",
  "importBatchId",
] as const;

/**
 * Compute the earliest date at which a member's personal data can be erased
 * without violating financial retention rules. `lastFinancialEventAt` is
 * typically `MAX(soll_stellungen.created_at, fee_run_items.created_at,
 * sepa_mandates.letzte_verwendung)` for the member; the caller passes that in.
 */
export function earliestErasureDate(opts: {
  austritt: Date | null | undefined;
  verstorbenAm: Date | null | undefined;
  lastFinancialEventAt: Date | null | undefined;
}): Date {
  const candidates: Date[] = [];
  if (opts.lastFinancialEventAt) {
    const d = new Date(opts.lastFinancialEventAt);
    d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS.financial);
    candidates.push(d);
  }
  if (opts.austritt) {
    const d = new Date(opts.austritt);
    d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS.financial);
    candidates.push(d);
  }
  if (opts.verstorbenAm) {
    const d = new Date(opts.verstorbenAm);
    d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS.financial);
    candidates.push(d);
  }
  if (candidates.length === 0) {
    // No financial activity ever — erasure can happen immediately.
    return new Date(0);
  }
  return candidates.reduce((a, b) => (a > b ? a : b));
}
