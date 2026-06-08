/**
 * Pure builder for the Ehrungsurkunde (honor certificate). Turns the resolved
 * honor and club data into the flat strings the react-pdf certificate renders.
 * Kept free of DB/IO so it is unit-testable, and free of em/en dashes per the
 * house style.
 */

import { altMitgliedsnummer } from "~/lib/member-ref";

export type EhrungsurkundeInput = {
  vereinsname: string;
  /** Town the certificate is dated in (Vereinssitz), or null. */
  ort: string | null;
  logoDataUri: string | null;
  /** Honored member's display name. */
  empfaengerName: string;
  /** Preserved legacy Linear Mitgliedsnummer, printed small in the footer. */
  mitgliedsnummer: string | null;
  kind: "vereinsjubilaeum" | "sonderehrung";
  /** Years of membership for a Vereinsjubiläum, else null. */
  jubilaeumJahre: number | null;
  /** Stored honor title (e.g. "25 Jahre Mitgliedschaft" or "Goldene Ehrennadel"). */
  titel: string;
  /** Award date (ISO yyyy-mm-dd). */
  verliehenAm: string;
  /** Document reference, e.g. "EU-2025-0007". */
  docRef: string;
};

export type EhrungsurkundeModel = {
  vereinsname: string;
  logoDataUri: string | null;
  docRef: string;
  /** Legacy Linear Mitgliedsnummer shown small in the footer, or null. */
  legacyMitgliedsnummer: string | null;
  /** Large heading. */
  ueberschrift: string;
  /** Lead line above the name. */
  verleihtZeile: string;
  empfaengerName: string;
  /** The honor itself, emphasised under the name. */
  ehrungTitel: string;
  /** One-sentence appreciation paragraph. */
  wuerdigung: string;
  /** "Untereuerheim, den 15.03.2025" or just the date when no town is set. */
  ortDatumZeile: string;
  unterschriftLinks: string;
  unterschriftRechts: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Format an ISO date (yyyy-mm-dd) as dd.mm.yyyy. Passes other strings through. */
export function fmtUrkundeDate(value: string): string {
  if (!value || !ISO_DATE.test(value)) return value;
  const [y, mo, d] = value.split("-");
  return `${d}.${mo}.${y}`;
}

export function buildEhrungsurkundeModel(input: EhrungsurkundeInput): EhrungsurkundeModel {
  const datum = fmtUrkundeDate(input.verliehenAm);
  const ortDatumZeile = input.ort?.trim() ? `${input.ort.trim()}, den ${datum}` : datum;

  // The appreciation wording differs by kind: an anniversary thanks the years
  // of loyalty; a Sonderehrung honors merit around the club.
  const wuerdigung =
    input.kind === "vereinsjubilaeum" && input.jubilaeumJahre != null
      ? `in Anerkennung und Dankbarkeit für ${input.jubilaeumJahre} Jahre treue Mitgliedschaft und die langjährige Verbundenheit mit unserem Verein.`
      : `in Anerkennung und Dankbarkeit für die besonderen Verdienste um den ${input.vereinsname}.`;

  return {
    vereinsname: input.vereinsname,
    logoDataUri: input.logoDataUri,
    docRef: input.docRef,
    legacyMitgliedsnummer: altMitgliedsnummer(input.mitgliedsnummer, ""),
    ueberschrift: "Ehrenurkunde",
    verleihtZeile: `Der ${input.vereinsname} verleiht`,
    empfaengerName: input.empfaengerName,
    ehrungTitel: input.titel,
    wuerdigung,
    ortDatumZeile,
    unterschriftLinks: "1. Vorsitzende/r",
    unterschriftRechts: "2. Vorsitzende/r",
  };
}
