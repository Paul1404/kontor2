/**
 * Human-readable German labels for the ISO 20022 / SEPA R-transaction reason
 * codes that turn up on Rücklastschriften (camt.054 `RtrInf/Rsn/Cd`) and on
 * manually entered Rückläufer. Banks return the bare 4-letter code; showing it
 * raw ("MS03") is meaningless to the office, so we map the common ones.
 *
 * Not exhaustive: unknown codes fall through to the raw code so nothing is
 * hidden. Keep labels short and direct.
 */
export const SEPA_RETURN_REASONS: Record<string, string> = {
  AC01: "Kontonummer fehlerhaft",
  AC04: "Konto geschlossen",
  AC06: "Konto gesperrt",
  AC13: "Falsche Kontoart",
  AG01: "Lastschrift nicht erlaubt",
  AG02: "Ungültiger Buchungscode",
  AM04: "Konto ohne Deckung",
  AM05: "Doppelte Einreichung",
  BE01: "Schuldner stimmt nicht mit Kontoinhaber überein",
  BE04: "Anschrift des Gläubigers fehlt",
  BE05: "Gläubiger-Identifikation fehlerhaft",
  CNOR: "Bank des Gläubigers nicht registriert",
  DNOR: "Bank des Schuldners nicht registriert",
  FF01: "Ungültiges Dateiformat",
  FF05: "Lastschrifttyp unbekannt",
  MD01: "Kein gültiges Mandat",
  MD02: "Mandatsangaben fehlen oder unvollständig",
  MD06: "Erstattung vom Schuldner verlangt",
  MD07: "Schuldner verstorben",
  MS02: "Widerspruch durch Schuldner",
  MS03: "Kein Grund angegeben",
  RC01: "BIC fehlerhaft",
  RR01: "Konto- oder Identifikationsangaben des Schuldners fehlen",
  RR02: "Name oder Anschrift des Schuldners fehlt",
  RR03: "Name oder Anschrift des Gläubigers fehlt",
  RR04: "Regulatorischer Grund",
  SL01: "Service der Schuldnerbank",
  TM01: "Annahmeschluss überschritten",
};

/** Plain German label for a reason code, or `null` if the code is unknown. */
export function sepaReturnReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SEPA_RETURN_REASONS[code.trim().toUpperCase()] ?? null;
}

/**
 * Display string for a reason code: "CODE: Label" when known, the bare code
 * when not, and `null` for an empty input (the caller renders the empty glyph).
 */
export function formatSepaReturnReason(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const label = SEPA_RETURN_REASONS[c];
  return label ? `${c}: ${label}` : c;
}

/** Code + label options for a select, sorted by code. */
export const SEPA_RETURN_REASON_OPTIONS: ReadonlyArray<{ code: string; label: string }> =
  Object.entries(SEPA_RETURN_REASONS)
    .map(([code, label]) => ({ code, label: `${code}: ${label}` }))
    .sort((a, b) => a.code.localeCompare(b.code));
