/**
 * Pure builder for the Austrittsbestätigung (cancellation confirmation). It
 * resolves the salutation, the recipient (member or a different parent/payer),
 * the family-vs-single wording and all dates into a flat model the react-pdf
 * component renders. Kept free of DB/IO so it is unit-testable, and free of
 * em/en dashes per the house style.
 *
 * Ported from the svums Jinja template `kuendigungsbestaetigung.html`, adapted
 * to Kontor2's data and stack.
 */

import { altMitgliedsnummer } from "~/lib/member-ref";
import type { CancellationDateMode } from "~/lib/tenant-settings";

export type CancellationFamilyMemberInput = {
  vorname: string;
  nachname: string;
  geburtsdatum?: string | null;
  mitgliedsnummer?: string | null;
};

export type CancellationClub = {
  vereinsname: string;
  ort: string;
  /** Postal address for the DIN 5008 return line above the recipient. */
  anschriftStrasse?: string | null;
  anschriftPlz?: string | null;
  anschriftOrt?: string | null;
  kontaktEmail: string | null;
  kontaktTelefon: string | null;
  datenschutzUrl: string | null;
  satzungUrl: string | null;
  logoDataUri: string | null;
  cancellationDateMode?: CancellationDateMode;
  cancellationNoticeDays?: number;
  cancellationStatuteReference?: string | null;
  outstandingClaimsStatuteReference?: string | null;
  privacyStatuteReference?: string | null;
};

export type CancellationInput = {
  /** The member the membership belongs to (authoritative identity). */
  member: {
    anrede: string | null;
    vorname: string | null;
    nachname: string | null;
    strasse: string | null;
    plz: string | null;
    ort: string | null;
    geburtsdatum: Date | string | null;
    /** The reference shown to the member (app number preferred). */
    mitgliedsnummer: string | null;
    /** Preserved legacy Linear Mitgliedsnummer, printed as a separate "(alt)" line. */
    legacyMitgliedsnummer?: string | null;
  };
  /** Austrittstermin, accepts ISO (yyyy-mm-dd) or an already formatted string. */
  austrittDatum: string;
  /** Free-text department line, or null to omit. */
  abteilung?: string | null;
  /** Recipient differs from the member (e.g. legal guardian / payer). */
  empfaengerAbweichend?: boolean;
  empfaenger?: {
    anrede?: string | null;
    vorname?: string | null;
    nachname?: string | null;
    strasse?: string | null;
    plz?: string | null;
    ort?: string | null;
  } | null;
  isFamily?: boolean;
  familienmitglieder?: CancellationFamilyMemberInput[];
  club: CancellationClub;
  /** Letter date; defaults to today. Injectable for deterministic tests. */
  today?: Date;
};

export type CancellationModelFamilyMember = {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  mitgliedsnummer: string;
};

export type CancellationModel = {
  club: CancellationClub;
  /** Address block, first line is the salutation word ("Herrn"/"Frau"/""). */
  recipient: {
    anredeZeile: string;
    name: string;
    strasse: string;
    plzOrt: string;
  };
  /** "Sehr geehrte Frau Mustermann," etc. (already terminated with a comma). */
  anrede: string;
  ortDatum: string;
  subject: string;
  bodyIntro: string;
  bodyClause: string;
  bodyThanks: string;
  istEmpfaengerAbweichend: boolean;
  isFamily: boolean;
  member: { vorname: string; nachname: string; geburtsdatum: string; mitgliedsnummer: string };
  /** Legacy Linear Mitgliedsnummer for the info block, or null when none/duplicate. */
  legacyMitgliedsnummer: string | null;
  abteilung: string;
  austrittDatum: string;
  familienmitglieder: CancellationModelFamilyMember[];
  closing: string;
  /** Combined member-number summary for storage/display, e.g. "A: 1, B: 2". */
  combinedMitgliedsnummer: string;
  /** "Mustermann, Erika" or "... (Familie)". */
  displayName: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Format a date as dd.mm.yyyy. Passes through strings that aren't ISO dates. */
export function formatGermanDate(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const m = ISO_DATE.exec(value);
  if (m) {
    const [y, mo, d] = value.split("-");
    return `${d}.${mo}.${y}`;
  }
  return value;
}

function formatParts(year: number, month: number, day: number): string {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}.${mm}.${year}`;
}

/**
 * Resolve a salutation into the letter greeting and the address-block word.
 * Tolerates Linear's free-text Anrede ("Herr", "Herrn", "Frau", titles, null).
 */
export function resolveAnrede(
  anrede: string | null | undefined,
  vorname: string,
  nachname: string,
): { greeting: string; anredeZeile: string } {
  const a = (anrede ?? "").trim().toLowerCase();
  if (a.startsWith("herr")) {
    return { greeting: `Sehr geehrter Herr ${nachname}`, anredeZeile: "Herrn" };
  }
  if (a.startsWith("frau")) {
    return { greeting: `Sehr geehrte Frau ${nachname}`, anredeZeile: "Frau" };
  }
  // No usable salutation: fall back to a neutral, name-based greeting.
  const fullName = `${vorname} ${nachname}`.trim();
  return { greeting: `Guten Tag ${fullName}`, anredeZeile: "" };
}

export function buildCancellationModel(input: CancellationInput): CancellationModel {
  const club = input.club;
  const m = input.member;
  const memberVorname = (m.vorname ?? "").trim();
  const memberNachname = (m.nachname ?? "").trim();

  const family = (input.familienmitglieder ?? []).filter(
    (fm) => fm.vorname.trim() !== "" || fm.nachname.trim() !== "",
  );
  const isFamily = Boolean(input.isFamily && family.length > 0);

  const abweichend = Boolean(
    input.empfaengerAbweichend &&
      input.empfaenger &&
      (input.empfaenger.vorname ?? "").trim() !== "" &&
      (input.empfaenger.nachname ?? "").trim() !== "",
  );

  const e = abweichend
    ? {
        anrede: input.empfaenger?.anrede ?? null,
        vorname: (input.empfaenger?.vorname ?? "").trim(),
        nachname: (input.empfaenger?.nachname ?? "").trim(),
        strasse: (input.empfaenger?.strasse ?? m.strasse ?? "").trim(),
        plz: (input.empfaenger?.plz ?? m.plz ?? "").trim(),
        ort: (input.empfaenger?.ort ?? m.ort ?? "").trim(),
      }
    : {
        anrede: m.anrede ?? null,
        vorname: memberVorname,
        nachname: memberNachname,
        strasse: (m.strasse ?? "").trim(),
        plz: (m.plz ?? "").trim(),
        ort: (m.ort ?? "").trim(),
      };

  const { greeting, anredeZeile } = resolveAnrede(e.anrede, e.vorname, e.nachname);

  const austritt = formatGermanDate(input.austrittDatum);
  const ortDatum = `${club.ort}, den ${formatGermanDate(input.today ?? new Date())}`;
  const memberFull = `${memberVorname} ${memberNachname}`.trim();

  const subject = isFamily
    ? "Bestätigung des Austritts der Familienmitgliedschaft aus dem Verein"
    : abweichend
      ? `Bestätigung des Austritts von ${memberFull} aus dem Verein`
      : "Bestätigung Ihres Austritts aus dem Verein";

  const bodyIntro = isFamily
    ? `hiermit bestätigen wir den Eingang der schriftlichen Austrittserklärung und das Ende der Familienmitgliedschaft beim ${club.vereinsname}.`
    : abweichend
      ? `hiermit bestätigen wir den Eingang der schriftlichen Austrittserklärung und das Ende der Mitgliedschaft von ${memberFull} beim ${club.vereinsname}.`
      : `hiermit bestätigen wir den Eingang Ihrer schriftlichen Austrittserklärung und das Ende Ihrer Mitgliedschaft beim ${club.vereinsname}.`;

  const ruleSource = club.cancellationStatuteReference
    ? `Gemäß ${club.cancellationStatuteReference} der Vereinssatzung`
    : "Nach den hinterlegten Kündigungsregeln";
  const dateRule =
    club.cancellationDateMode === "year_end"
      ? "ist der Austritt nur zum Schluss eines Kalenderjahres"
      : club.cancellationDateMode === "month_end"
        ? "ist der Austritt nur zum Ende eines Monats"
        : "ist der Austritt zum bestätigten Datum";
  const noticeRule =
    (club.cancellationNoticeDays ?? 0) > 0
      ? ` unter Einhaltung einer Frist von ${club.cancellationNoticeDays} Tagen`
      : "";
  const clauseHead = `${ruleSource} ${dateRule}${noticeRule} zulässig. `;
  const claimsSource = club.outstandingClaimsStatuteReference
    ? ` gemäß ${club.outstandingClaimsStatuteReference} der Satzung`
    : "";
  const clauseTail = `Bis dahin bestehende Beitragspflichten bleiben unberührt; der Anspruch des Vereins auf rückständige Beiträge oder sonstige Forderungen bleibt${claimsSource} auch nach Beendigung der Mitgliedschaft bestehen.`;
  const sepaText = (von: boolean) =>
    ` Das ${von ? "von Ihnen " : ""}erteilte SEPA-Lastschriftmandat wird mit Beendigung der Mitgliedschaft ebenfalls widerrufen.`;
  const bodyClause = isFamily
    ? `${clauseHead}Die Familienmitgliedschaft endet somit zum oben genannten Datum für alle genannten Mitglieder. ${clauseTail}${sepaText(false)}`
    : abweichend
      ? `${clauseHead}Die Mitgliedschaft von ${memberFull} endet somit zum oben genannten Datum. ${clauseTail}${sepaText(true)}`
      : `${clauseHead}Ihre Mitgliedschaft endet somit zum oben genannten Datum. ${clauseTail}${sepaText(false)}`;

  const bodyThanks = abweichend
    ? `Wir bedanken uns für die Zeit von ${memberFull} als Mitglied in unserem Verein und wünschen Ihnen für die Zukunft alles Gute.`
    : "Wir bedanken uns für Ihre Zeit als Mitglied in unserem Verein und wünschen Ihnen für die Zukunft alles Gute.";

  const familienmitglieder: CancellationModelFamilyMember[] = family.map((fm) => ({
    vorname: fm.vorname.trim(),
    nachname: fm.nachname.trim(),
    geburtsdatum: formatGermanDate(fm.geburtsdatum ?? null),
    mitgliedsnummer: (fm.mitgliedsnummer ?? "").trim(),
  }));

  const numbers: { name: string; nummer: string }[] = [];
  if (m.mitgliedsnummer) numbers.push({ name: memberFull, nummer: m.mitgliedsnummer });
  for (const fm of familienmitglieder) {
    if (fm.mitgliedsnummer) {
      numbers.push({ name: `${fm.vorname} ${fm.nachname}`.trim(), nummer: fm.mitgliedsnummer });
    }
  }
  const combinedMitgliedsnummer =
    isFamily && numbers.length > 0
      ? numbers.map((n) => `${n.name}: ${n.nummer}`).join(", ")
      : (m.mitgliedsnummer ?? "");

  const displayName =
    isFamily && familienmitglieder.length > 0
      ? `${[
          `${memberNachname}, ${memberVorname}`,
          ...familienmitglieder.map((fm) => `${fm.nachname}, ${fm.vorname}`),
        ].join(" | ")} (Familie)`
      : `${memberNachname}, ${memberVorname}`;

  return {
    club,
    recipient: {
      anredeZeile,
      name: `${e.vorname} ${e.nachname}`.trim(),
      strasse: e.strasse,
      plzOrt: `${e.plz} ${e.ort}`.trim(),
    },
    anrede: `${greeting},`,
    ortDatum,
    subject,
    bodyIntro,
    bodyClause,
    bodyThanks,
    istEmpfaengerAbweichend: abweichend,
    isFamily,
    member: {
      vorname: memberVorname,
      nachname: memberNachname,
      geburtsdatum: formatGermanDate(m.geburtsdatum),
      mitgliedsnummer: m.mitgliedsnummer ?? "",
    },
    legacyMitgliedsnummer: altMitgliedsnummer(m.legacyMitgliedsnummer, m.mitgliedsnummer ?? ""),
    abteilung: (input.abteilung ?? "").trim(),
    austrittDatum: austritt,
    familienmitglieder,
    closing: `Mit freundlichen Grüßen aus ${club.ort}`,
    combinedMitgliedsnummer,
    displayName,
  };
}
