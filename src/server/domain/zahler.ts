/**
 * Zahler-Aufloesung: wessen Konto wird fuer den Beitrag eines Mitglieds
 * belastet, und wessen SEPA-Mandat gilt.
 *
 * Erste Ausbaustufe des Zahler-Konzepts (docs/zahler-konzept.md): die
 * Aufloesung stuetzt sich nur auf Daten, die einen Re-Import ueberleben
 * (Familien und Beziehungen), nicht auf eine Vertragsspalte -- Vertraege
 * werden beim Import ersetzt.
 *
 * Prioritaet:
 * 1. Familie: ist das Mitglied aktives Kind einer Familie mit Zahler, zahlt
 *    der Familien-Zahler.
 * 2. Vertreter: ist das Mitglied minderjaehrig und hat eine Beziehung mit
 *    Vertreter-Flag, zahlt der Vertreter (Erziehungsberechtigte).
 * 3. Sonst: Selbstzahler.
 *
 * Erwachsene werden nie automatisch umgeleitet: ein Partner mit eigenem
 * Vertrag zahlt selbst, solange kein expliziter Zahler gepflegt ist.
 */

export type ZahlerQuelle = "vertrag" | "familie" | "vertreter" | "selbst";

export type ZahlerResolution = { zahlerId: string; quelle: ZahlerQuelle };

export function resolveZahler(opts: {
  memberId: string;
  /** Expliziter Zahler am Vertrag (Stufe 2). Hat Vorrang vor allem. */
  explicitZahlerId?: string | null;
  /** Zahler der Familie, in der das Mitglied aktives Kind ist (sonst null). */
  familieZahlerId: string | null;
  /** Ziel der Beziehung mit Vertreter-Flag (sonst null). */
  vertreterId: string | null;
  minderjaehrig: boolean;
}): ZahlerResolution {
  if (opts.explicitZahlerId && opts.explicitZahlerId !== opts.memberId) {
    return { zahlerId: opts.explicitZahlerId, quelle: "vertrag" };
  }
  if (opts.familieZahlerId && opts.familieZahlerId !== opts.memberId) {
    return { zahlerId: opts.familieZahlerId, quelle: "familie" };
  }
  if (opts.minderjaehrig && opts.vertreterId && opts.vertreterId !== opts.memberId) {
    return { zahlerId: opts.vertreterId, quelle: "vertreter" };
  }
  return { zahlerId: opts.memberId, quelle: "selbst" };
}
