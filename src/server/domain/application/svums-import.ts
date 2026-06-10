import * as v from "valibot";
import type {
  AntragKind,
  AntragStatus,
  AntragTyp,
  MitgliedschaftTyp,
} from "~/server/db/schema/membership-applications";
import {
  type Antragstyp,
  mitgliedschaftTypFor,
  parseISODate,
} from "~/server/domain/application/antragstyp";
import { normalizeIban, validateIban } from "~/server/sepa/iban";

/**
 * Mapping layer for the one-off SVUMS Antrags-Import: turns the JSON the
 * standalone svums app serves at `GET /api/admin/applications` (its
 * `ApplicationResponse` shape, IBAN already decrypted) into rows for
 * `membership_applications`. Kept free of DB/IO so it is unit-testable;
 * the oRPC procedure owns Antragsnummer allocation and inserts.
 */

const NullableStr = v.optional(v.nullable(v.string()), null);
const NullableBool = v.optional(v.nullable(v.boolean()), null);

const SvumsKindSchema = v.looseObject({
  vorname: v.string(),
  nachname: v.string(),
  geburtsdatum: v.string(),
  abteilungen: v.optional(v.array(v.string()), []),
});

export const SvumsApplicationSchema = v.looseObject({
  id: v.pipe(v.number(), v.integer()),
  antragsnummer: NullableStr,
  antragstyp: NullableStr,
  geschlecht: NullableStr,
  vorname: v.string(),
  nachname: v.string(),
  geburtsdatum: v.string(),
  strasse: NullableStr,
  plz: NullableStr,
  ort: NullableStr,
  telefon: NullableStr,
  email: NullableStr,
  erziehungsberechtigter_vorname: NullableStr,
  erziehungsberechtigter_nachname: NullableStr,
  partner_vorname: NullableStr,
  partner_nachname: NullableStr,
  partner_geburtsdatum: NullableStr,
  partner_abteilungen: v.optional(v.nullable(v.array(v.string())), null),
  kinder: v.optional(v.nullable(v.array(SvumsKindSchema)), null),
  abteilungen: v.optional(v.array(v.string()), []),
  mitgliedschaft_typ: NullableStr,
  elternteil_mitglied: NullableBool,
  jahresbeitrag: v.optional(v.nullable(v.union([v.string(), v.number()])), null),
  kontoinhaber: NullableStr,
  iban: NullableStr,
  bic: NullableStr,
  kreditinstitut: NullableStr,
  mandatsreferenz: NullableStr,
  status: NullableStr,
  notes: NullableStr,
  admin_decline_reason: NullableStr,
  mitgliedsnummer: NullableStr,
  consent_at: NullableStr,
  datenschutz_accepted: NullableBool,
  satzung_accepted: NullableBool,
  consent_ip: NullableStr,
  email_sent: NullableBool,
  is_test: NullableBool,
  source: NullableStr,
  created_at: v.string(),
  // Object-storage keys of the documents in svums (flat, derived from the
  // Antragsnummer, e.g. "ANT-2024-0007_signed.pdf"). Used to match entries
  // of an optionally uploaded ZIP of the svums bucket.
  uploaded_file: NullableStr,
  uploaded_at: NullableStr,
  admin_approved_file: NullableStr,
});

export type SvumsApplication = v.InferOutput<typeof SvumsApplicationSchema>;

const ANTRAGSTYPEN: AntragTyp[] = ["einzel", "kind", "familie"];
const STATUSES: AntragStatus[] = [
  "neu",
  "scan_eingegangen",
  "dokument_hochgeladen",
  "in_bearbeitung",
  "genehmigt",
  "abgelehnt",
];
const MITGLIEDSCHAFT_TYPEN: MitgliedschaftTyp[] = [
  "kind",
  "jugendlich",
  "junger_erwachsener",
  "erwachsener",
  "familie",
];

const GESCHLECHT_MAP: Record<string, "m" | "w" | "unbekannt"> = {
  Herr: "m",
  Frau: "w",
  "keine Angabe": "unbekannt",
};

/**
 * Parse the saved JSON of the svums admin API. Accepts the paginated
 * `{ items: [...] }` envelope as well as a bare array of applications.
 * Rows that fail validation are reported, not fatal.
 */
export function parseSvumsExport(text: string): { items: SvumsApplication[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein gültiges JSON.");
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
      ? ((parsed as { items: unknown[] }).items as unknown[])
      : null;
  if (!raw) {
    throw new Error(
      "Unerwartetes Format. Erwartet wird die Antwort von /api/admin/applications (Objekt mit items) oder eine Liste von Anträgen.",
    );
  }
  const items: SvumsApplication[] = [];
  const errors: string[] = [];
  raw.forEach((entry, idx) => {
    const res = v.safeParse(SvumsApplicationSchema, entry);
    if (res.success) {
      items.push(res.output);
    } else {
      const first = res.issues[0];
      const path = first.path?.map((p) => String(p.key)).join(".") ?? "";
      errors.push(`Eintrag ${idx + 1}: ungültig (${path ? `${path}: ` : ""}${first.message})`);
    }
  });
  return { items, errors };
}

/** Split "Musterweg 3a" into street and house number; svums stores them in one field. */
export function splitStrasse(value: string | null): {
  strasse: string | null;
  hausnummer: string | null;
} {
  const s = value?.trim() ?? "";
  if (!s) return { strasse: null, hausnummer: null };
  const m = /^(.*[^\s\d])\s+(\d[\d\s/-]*[a-zA-Z]?)$/.exec(s);
  if (!m) return { strasse: s, hausnummer: null };
  return { strasse: m[1]!.trim(), hausnummer: m[2]!.trim() };
}

/**
 * svums timestamps come from `datetime.utcnow()` and are serialized without
 * a timezone suffix; treat suffix-less values as UTC.
 */
export function parseSvumsTimestamp(value: string | null): Date | null {
  if (!value) return null;
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const d = new Date(hasTz ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalize the Decimal-or-number Jahresbeitrag into a 2-decimal numeric string. */
export function normalizeBeitrag(value: string | number | null): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/**
 * Idempotency key for an imported application: name + birth date + the exact
 * svums creation timestamp. Stable across re-imports even when the
 * Antragsnummer had to be re-minted because of a collision.
 */
export function svumsDedupeKey(row: {
  vorname: string;
  nachname: string;
  geburtsdatum: Date;
  createdAt: Date;
}): string {
  return [
    row.vorname.trim().toLowerCase(),
    row.nachname.trim().toLowerCase(),
    row.geburtsdatum.toISOString().slice(0, 10),
    row.createdAt.getTime(),
  ].join("|");
}

export type SvumsMappedValues = {
  antragstyp: AntragTyp;
  status: AntragStatus;
  source: "online" | "legacy";
  mitgliedschaftTyp: MitgliedschaftTyp;
  geschlecht: "m" | "w" | "unbekannt" | null;
  vorname: string;
  nachname: string;
  geburtsdatum: Date;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  erziehungsberechtigterVorname: string | null;
  erziehungsberechtigterNachname: string | null;
  partnerVorname: string | null;
  partnerNachname: string | null;
  partnerGeburtsdatum: Date | null;
  partnerAbteilungen: string[];
  kinder: AntragKind[];
  abteilungen: string[];
  elternteilMitglied: boolean;
  jahresbeitrag: string | null;
  kontoinhaber: string | null;
  iban: string | null;
  bic: string | null;
  kreditinstitut: string | null;
  mandatsreferenz: string | null;
  notes: string;
  adminDeclineReason: string | null;
  mitgliedsnummer: string | null;
  consentAt: Date | null;
  datenschutzAccepted: boolean | null;
  satzungAccepted: boolean | null;
  consentIp: string | null;
  emailSent: boolean;
  isTest: boolean;
  createdAt: Date;
};

export type SvumsMappedApplication = {
  svumsId: number;
  /** Original reference, kept when free; the procedure re-mints on collision. */
  originalAntragsnummer: string | null;
  /** Storage key of the signed scan in svums, for the optional documents ZIP. */
  uploadedFile: string | null;
  uploadedAt: Date | null;
  /** Storage key of the countersigned approval PDF in svums. */
  adminApprovedFile: string | null;
  values: SvumsMappedValues;
  warnings: string[];
};

/** Last path segment of an svums storage key (ZIPs may add folder prefixes). */
export function fileBasename(key: string): string {
  return key.split("/").pop()?.trim() ?? "";
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

/** Content type for an svums document filename (matches the svums allow-list). */
export function mimeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Normalize the user-entered svums base URL: trim, default to https when no
 * scheme was typed, drop trailing slashes and any path/query. Returns null
 * for values that are not a usable http(s) origin.
 */
export function normalizeSvumsBaseUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return null;
  const withScheme = hasScheme ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * Map one svums application onto the `membership_applications` insert shape.
 * Abteilungen arrive as display names; they are resolved against the local
 * Abteilungen by case-insensitive name. Unresolvable names are dropped from
 * the id arrays (a later approval must not hit a foreign key) and recorded
 * in the provenance note instead.
 */
export function mapSvumsApplication(
  item: SvumsApplication,
  opts: { abteilungIdByName: Map<string, string>; importedAt: Date },
): SvumsMappedApplication {
  const warnings: string[] = [];
  const unmatchedAbteilungen = new Set<string>();

  const mapAbt = (names: string[] | null | undefined): string[] => {
    const out: string[] = [];
    for (const name of names ?? []) {
      const id = opts.abteilungIdByName.get(name.trim().toLowerCase());
      if (id) out.push(id);
      else unmatchedAbteilungen.add(name.trim());
    }
    return out;
  };

  const geburtsdatum = parseISODate(item.geburtsdatum);
  if (Number.isNaN(geburtsdatum.getTime())) {
    throw new Error(`Geburtsdatum ungültig: ${item.geburtsdatum}`);
  }
  const createdAt = parseSvumsTimestamp(item.created_at);
  if (!createdAt) {
    throw new Error(`Eingangsdatum ungültig: ${item.created_at}`);
  }

  const antragstyp: AntragTyp = ANTRAGSTYPEN.includes(item.antragstyp as AntragTyp)
    ? (item.antragstyp as AntragTyp)
    : "einzel";
  if (item.antragstyp && antragstyp !== item.antragstyp) {
    warnings.push(`Unbekannter Antragstyp "${item.antragstyp}", als "einzel" übernommen.`);
  }

  let status: AntragStatus;
  if (STATUSES.includes(item.status as AntragStatus)) {
    status = item.status as AntragStatus;
  } else {
    status = "neu";
    if (item.status) warnings.push(`Unbekannter Status "${item.status}", als "neu" übernommen.`);
  }

  let mitgliedschaftTyp: MitgliedschaftTyp;
  if (MITGLIEDSCHAFT_TYPEN.includes(item.mitgliedschaft_typ as MitgliedschaftTyp)) {
    mitgliedschaftTyp = item.mitgliedschaft_typ as MitgliedschaftTyp;
  } else {
    mitgliedschaftTyp = mitgliedschaftTypFor(antragstyp as Antragstyp, geburtsdatum);
    warnings.push(
      `Mitgliedschaftstyp "${item.mitgliedschaft_typ ?? ""}" unbekannt, aus dem Geburtsdatum abgeleitet: ${mitgliedschaftTyp}.`,
    );
  }

  let iban: string | null = null;
  if (item.iban?.trim()) {
    const normalized = normalizeIban(item.iban);
    if (validateIban(normalized)) {
      iban = normalized;
    } else {
      warnings.push("IBAN ungültig oder nicht entschlüsselbar, nicht übernommen.");
    }
  }

  const beitrag = normalizeBeitrag(item.jahresbeitrag);
  if (item.jahresbeitrag != null && item.jahresbeitrag !== "" && beitrag === null) {
    warnings.push(`Jahresbeitrag "${item.jahresbeitrag}" nicht lesbar, nicht übernommen.`);
  }

  let partnerGeburtsdatum: Date | null = null;
  if (item.partner_geburtsdatum) {
    const d = parseISODate(item.partner_geburtsdatum);
    if (Number.isNaN(d.getTime())) {
      warnings.push(`Partner-Geburtsdatum "${item.partner_geburtsdatum}" ungültig, leer gelassen.`);
    } else {
      partnerGeburtsdatum = d;
    }
  }

  const { strasse, hausnummer } = splitStrasse(item.strasse);
  const abteilungen = mapAbt(item.abteilungen);
  const partnerAbteilungen = mapAbt(item.partner_abteilungen);
  const kinder: AntragKind[] = (item.kinder ?? []).map((k) => ({
    vorname: k.vorname,
    nachname: k.nachname,
    geburtsdatum: k.geburtsdatum,
    abteilungen: mapAbt(k.abteilungen),
  }));
  if (unmatchedAbteilungen.size > 0) {
    warnings.push(
      `Abteilungen nicht zugeordnet (im Hinweisfeld vermerkt): ${[...unmatchedAbteilungen].join(", ")}.`,
    );
  }

  const noteLines = [
    `Importiert aus SVUMS (Antrag ${item.antragsnummer ?? `#${item.id}`}) am ${opts.importedAt.toLocaleDateString("de-DE")}.`,
  ];
  if (unmatchedAbteilungen.size > 0) {
    noteLines.push(`Nicht zugeordnete Abteilungen: ${[...unmatchedAbteilungen].join(", ")}.`);
  }
  const notes = [item.notes?.trim(), noteLines.join("\n")].filter(Boolean).join("\n\n");

  return {
    svumsId: item.id,
    originalAntragsnummer: item.antragsnummer?.trim().toUpperCase() || null,
    uploadedFile: item.uploaded_file?.trim() || null,
    uploadedAt: parseSvumsTimestamp(item.uploaded_at),
    adminApprovedFile: item.admin_approved_file?.trim() || null,
    warnings,
    values: {
      antragstyp,
      status,
      source: item.source === "legacy" ? "legacy" : "online",
      mitgliedschaftTyp,
      geschlecht: item.geschlecht ? (GESCHLECHT_MAP[item.geschlecht] ?? "unbekannt") : null,
      vorname: item.vorname.trim(),
      nachname: item.nachname.trim(),
      geburtsdatum,
      strasse,
      hausnummer,
      plz: item.plz?.trim() || null,
      ort: item.ort?.trim() || null,
      telefon: item.telefon?.trim() || null,
      email: item.email?.trim() || null,
      erziehungsberechtigterVorname: item.erziehungsberechtigter_vorname?.trim() || null,
      erziehungsberechtigterNachname: item.erziehungsberechtigter_nachname?.trim() || null,
      partnerVorname: item.partner_vorname?.trim() || null,
      partnerNachname: item.partner_nachname?.trim() || null,
      partnerGeburtsdatum,
      partnerAbteilungen,
      kinder,
      abteilungen,
      elternteilMitglied: item.elternteil_mitglied ?? false,
      jahresbeitrag: beitrag,
      kontoinhaber: item.kontoinhaber?.trim() || null,
      iban,
      bic: item.bic ? item.bic.toUpperCase().replace(/\s+/g, "") : null,
      kreditinstitut: item.kreditinstitut?.trim() || null,
      mandatsreferenz: item.mandatsreferenz?.trim() || null,
      notes,
      adminDeclineReason: item.admin_decline_reason?.trim() || null,
      mitgliedsnummer: item.mitgliedsnummer?.trim() || null,
      consentAt: parseSvumsTimestamp(item.consent_at),
      datenschutzAccepted: item.datenschutz_accepted,
      satzungAccepted: item.satzung_accepted,
      consentIp: item.consent_ip?.trim() || null,
      emailSent: item.email_sent ?? false,
      isTest: item.is_test ?? false,
      createdAt,
    },
  };
}
