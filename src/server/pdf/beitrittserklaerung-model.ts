/**
 * Pure builder for the Beitrittserklärung (membership application) PDF. It
 * flattens an application plus the club data into a render-ready model. Kept
 * free of DB/IO so it is unit-testable, and free of em/en dashes per the
 * house style. Ported from the svums Jinja template `beitrittserklaerung.html`.
 */

import { formatGermanDate } from "~/server/pdf/cancellation-model";

export type BeitrittClub = {
  vereinsname: string;
  ort: string;
  anschriftStrasse?: string | null;
  anschriftPlz?: string | null;
  anschriftOrt?: string | null;
  kontaktEmail: string | null;
  kontaktTelefon: string | null;
  glaeubigerId: string | null;
  datenschutzUrl: string | null;
  satzungUrl: string | null;
  logoDataUri: string | null;
};

export type BeitrittKind = {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  abteilungen: string[];
};

export type BeitrittInput = {
  antragsnummer: string;
  antragstyp: "einzel" | "kind" | "familie";
  geschlecht: "m" | "w" | "d" | "unbekannt" | null;
  vorname: string;
  nachname: string;
  geburtsdatum: Date | string | null;
  strasse: string | null;
  hausnummer?: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  erziehungsberechtigterVorname?: string | null;
  erziehungsberechtigterNachname?: string | null;
  partnerVorname?: string | null;
  partnerNachname?: string | null;
  partnerGeburtsdatum?: Date | string | null;
  partnerAbteilungen?: string[];
  kinder?: BeitrittKind[];
  /** Abteilungs-Namen (already resolved from ids) for the main applicant. */
  abteilungen: string[];
  mitgliedschaftLabel: string;
  jahresbeitrag: string;
  kontoinhaber: string | null;
  ibanFormatted: string | null;
  bic: string | null;
  kreditinstitut: string | null;
  mandatsreferenz: string | null;
  consentAt: Date | null;
  /** Inline signature as a PNG data URI, or null for the paper path. */
  signatureDataUri?: string | null;
  /** Vorstand countersignature (PNG data URI), embedded on the approved PDF. */
  countersignatureDataUri?: string | null;
  /** Name under the countersignature, e.g. "Max Mustermann, 1. Vorsitzender". */
  countersignerName?: string | null;
  /** Approval date; when set the PDF is the genehmigte Beitrittserklärung. */
  approvedAt?: Date | string | null;
  club: BeitrittClub;
  today?: Date;
};

export type BeitrittDetailRow = { label: string; value: string };

export type BeitrittModel = {
  club: BeitrittClub;
  antragsnummer: string;
  titel: string;
  anrede: string;
  datum: string;
  /** Address block lines for the applicant / guardian. */
  empfaenger: string[];
  applicantRows: BeitrittDetailRow[];
  guardianRows: BeitrittDetailRow[];
  partnerRows: BeitrittDetailRow[];
  kinder: { name: string; geburtsdatum: string; abteilungen: string }[];
  abteilungen: string;
  mitgliedschaftLabel: string;
  jahresbeitrag: string;
  sepaRows: BeitrittDetailRow[];
  mandatstext: string;
  consentText: string;
  signatureDataUri: string | null;
  unterschriftName: string;
  countersignatureDataUri: string | null;
  countersignerName: string | null;
  /** Formatted approval date, or empty when the PDF is not yet approved. */
  approvedAt: string;
};

const GESCHLECHT_ANREDE: Record<string, string> = { m: "Herr", w: "Frau" };

function joinName(vorname: string | null | undefined, nachname: string | null | undefined): string {
  return `${(vorname ?? "").trim()} ${(nachname ?? "").trim()}`.trim();
}

export function buildBeitrittModel(input: BeitrittInput): BeitrittModel {
  const isKind = input.antragstyp === "kind";
  const isFamilie = input.antragstyp === "familie";

  const applicantFull = joinName(input.vorname, input.nachname);
  const guardianFull = joinName(
    input.erziehungsberechtigterVorname,
    input.erziehungsberechtigterNachname,
  );
  // For a Kind application the contact person is the guardian.
  const contactName = isKind && guardianFull ? guardianFull : applicantFull;

  const empfaenger = [
    GESCHLECHT_ANREDE[input.geschlecht ?? ""] ?? "",
    contactName,
    [input.strasse, input.hausnummer].filter(Boolean).join(" ").trim(),
    `${input.plz ?? ""} ${input.ort ?? ""}`.trim(),
  ].filter((l) => l.trim() !== "");

  const applicantRows: BeitrittDetailRow[] = [
    { label: "Name", value: applicantFull },
    { label: "Geburtsdatum", value: formatGermanDate(input.geburtsdatum) },
    {
      label: "Anschrift",
      value: [input.strasse, input.hausnummer].filter(Boolean).join(" ").trim(),
    },
    { label: "PLZ, Ort", value: `${input.plz ?? ""} ${input.ort ?? ""}`.trim() },
    ...(input.telefon ? [{ label: "Telefon", value: input.telefon }] : []),
    ...(input.email ? [{ label: "E-Mail", value: input.email }] : []),
  ].filter((r) => r.value.trim() !== "");

  const guardianRows: BeitrittDetailRow[] =
    isKind && guardianFull ? [{ label: "Erziehungsberechtigte/r", value: guardianFull }] : [];

  const partnerFull = joinName(input.partnerVorname, input.partnerNachname);
  const partnerRows: BeitrittDetailRow[] =
    isFamilie && partnerFull
      ? [
          { label: "Partner/2. Elternteil", value: partnerFull },
          ...(input.partnerGeburtsdatum
            ? [{ label: "Geburtsdatum", value: formatGermanDate(input.partnerGeburtsdatum) }]
            : []),
          ...((input.partnerAbteilungen ?? []).length > 0
            ? [{ label: "Abteilungen", value: (input.partnerAbteilungen ?? []).join(", ") }]
            : []),
        ]
      : [];

  const kinder =
    isFamilie && input.kinder
      ? input.kinder.map((k) => ({
          name: joinName(k.vorname, k.nachname),
          geburtsdatum: formatGermanDate(k.geburtsdatum),
          abteilungen: (k.abteilungen ?? []).join(", "),
        }))
      : [];

  const sepaRows: BeitrittDetailRow[] = [
    ...(input.kontoinhaber ? [{ label: "Kontoinhaber", value: input.kontoinhaber }] : []),
    ...(input.ibanFormatted ? [{ label: "IBAN", value: input.ibanFormatted }] : []),
    ...(input.bic ? [{ label: "BIC", value: input.bic }] : []),
    ...(input.kreditinstitut ? [{ label: "Kreditinstitut", value: input.kreditinstitut }] : []),
    ...(input.mandatsreferenz ? [{ label: "Mandatsreferenz", value: input.mandatsreferenz }] : []),
    ...(input.club.glaeubigerId ? [{ label: "Gläubiger-ID", value: input.club.glaeubigerId }] : []),
  ];

  const mandatstext =
    `Ich ermächtige den ${input.club.vereinsname}, Zahlungen von meinem Konto mittels Lastschrift ` +
    "einzuziehen. Zugleich weise ich mein Kreditinstitut an, die vom Verein auf mein Konto gezogenen " +
    "Lastschriften einzulösen. Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem " +
    "Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit " +
    "meinem Kreditinstitut vereinbarten Bedingungen.";

  const consentParts = [
    "Mit der Unterschrift werden die Datenschutzerklärung und die Satzung des Vereins anerkannt.",
    input.consentAt ? `Einwilligung erteilt am ${formatGermanDate(input.consentAt)}.` : "",
  ].filter(Boolean);

  return {
    club: input.club,
    antragsnummer: input.antragsnummer,
    titel: "Beitrittserklärung",
    // A Beitrittserklärung is written by the applicant TO the club ("hiermit
    // beantrage ich…"), so the greeting addresses the Verein, not the applicant.
    anrede: "Sehr geehrte Damen und Herren,",
    datum: formatGermanDate(input.today ?? new Date()),
    empfaenger,
    applicantRows,
    guardianRows,
    partnerRows,
    kinder,
    abteilungen: input.abteilungen.join(", "),
    mitgliedschaftLabel: input.mitgliedschaftLabel,
    jahresbeitrag: input.jahresbeitrag,
    sepaRows,
    mandatstext,
    consentText: consentParts.join(" "),
    signatureDataUri: input.signatureDataUri ?? null,
    unterschriftName: contactName,
    countersignatureDataUri: input.countersignatureDataUri ?? null,
    countersignerName: input.countersignerName?.trim() || null,
    approvedAt: input.approvedAt ? formatGermanDate(input.approvedAt) : "",
  };
}
