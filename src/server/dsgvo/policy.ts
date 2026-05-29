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
    anrede2: { kind: "null" },
    anredetitel: { kind: "null" },
    titel1: { kind: "null" },
    titel2: { kind: "null" },
    briefempfanger: { kind: "null" },
    briefanredeS: { kind: "null" },
    // Address
    strasse: { kind: "null" },
    hausnummer: { kind: "null" },
    plz: { kind: "null" },
    ort: { kind: "null" },
    landname: { kind: "null" },
    landKurzel: { kind: "null" },
    bundesland: { kind: "null" },
    lkz: { kind: "null" },
    adresszusatz: { kind: "null" },
    co: { kind: "null" },
    haus: { kind: "null" },
    bezirk: { kind: "null" },
    stadtteil: { kind: "null" },
    // Alternative postal addresses
    strasseRech: { kind: "null" },
    plzRech: { kind: "null" },
    ortRech: { kind: "null" },
    strasseLief: { kind: "null" },
    plzLief: { kind: "null" },
    ortLief: { kind: "null" },
    strassePost: { kind: "null" },
    plzPost: { kind: "null" },
    ortPost: { kind: "null" },
    strasseKih: { kind: "null" },
    plzKih: { kind: "null" },
    ortKih: { kind: "null" },
    postAnschriftStrasse: { kind: "null" },
    postAnschriftPlz: { kind: "null" },
    postAnschriftOrt: { kind: "null" },
    postAnschriftLand: { kind: "null" },
    postAnschriftPostfachStrasse: { kind: "null" },
    postAnschriftPostfachPlz: { kind: "null" },
    postAnschriftPostfachOrt: { kind: "null" },
    postAnschriftMemo1: { kind: "null" },
    postAnschriftMemo2: { kind: "null" },
    // Contact
    eMailName: { kind: "null" },
    emailKih: { kind: "null" },
    telefon1: { kind: "null" },
    telefon2: { kind: "null" },
    telefon3: { kind: "null" },
    telefon4: { kind: "null" },
    telefon5: { kind: "null" },
    telefon6: { kind: "null" },
    telefon7: { kind: "null" },
    vorwahl: { kind: "null" },
    vorwahl2: { kind: "null" },
    vorwahl3: { kind: "null" },
    vorwahl4: { kind: "null" },
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
    bic2: { kind: "null" },
    bic3: { kind: "null" },
    bank1: { kind: "null" },
    bank2: { kind: "null" },
    bank3: { kind: "null" },
    bank4: { kind: "null" },
    bank5: { kind: "null" },
    bank6: { kind: "null" },
    blz1: { kind: "null" },
    blz2: { kind: "null" },
    blz3: { kind: "null" },
    blz4: { kind: "null" },
    blz5: { kind: "null" },
    blz6: { kind: "null" },
    konto1: { kind: "null" },
    konto2: { kind: "null" },
    konto3: { kind: "null" },
    konto4: { kind: "null" },
    konto5: { kind: "null" },
    konto6: { kind: "null" },
    bank: { kind: "null" },
    blz: { kind: "null" },
    kontoNr: { kind: "null" },
    // Cards
    kreditkartenhalter: { kind: "null" },
    kreditkartennummer: { kind: "null" },
    kreditkartenname: { kind: "null" },
    kreditkarte: { kind: "null" },
    verfallsdatum: { kind: "null" },
    kartenNr1: { kind: "null" },
    kartenNr2: { kind: "null" },
    // Identity documents
    ausweisnummer: { kind: "null" },
    gueltigkeitsdatum: { kind: "null" },
    // Free text / notes that may contain personal narrative
    notes: { kind: "null" },
    benBemerk: { kind: "null" },
    benKontakt: { kind: "null" },
    benWieder: { kind: "null" },
    benAender: { kind: "null" },
    freeText1: { kind: "null" },
    freeText2: { kind: "null" },
    freeText3: { kind: "null" },
    freeText4: { kind: "null" },
    vertBem: { kind: "null" },
    bild: { kind: "null" },
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
