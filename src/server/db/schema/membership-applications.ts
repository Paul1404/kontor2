import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { geschlechtEnum, membersTable } from "~/server/db/schema/members";
import { encryptedText } from "~/server/db/types";

/**
 * Online membership application (Beitrittserklärung). This is the native
 * Kontor2 replacement for the standalone "svums" app: an applicant fills out a
 * public form at `/antrag`, optionally signs digitally, and the Vorstand
 * reviews and approves the row -- at which point `members.onboard` turns it
 * into a real member. Until approval there is no `members` row, so this table
 * stands on its own and does not reuse the member-scoped `attachments`.
 */
export const antragTypEnum = pgEnum("antrag_typ", ["einzel", "kind", "familie"]);

export const antragStatusEnum = pgEnum("antrag_status", [
  "neu",
  "scan_eingegangen",
  "dokument_hochgeladen",
  "in_bearbeitung",
  "genehmigt",
  "abgelehnt",
]);

export const antragSourceEnum = pgEnum("antrag_source", ["online", "legacy"]);

/** Age-bucket membership category, determined at Stichtag (Jan 1). */
export const mitgliedschaftTypEnum = pgEnum("mitgliedschaft_typ", [
  "kind",
  "jugendlich",
  "junger_erwachsener",
  "erwachsener",
  "familie",
]);

/** One child entry on a family application. `abteilungen` holds Abteilung ids. */
export type AntragKind = {
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  abteilungen: string[];
};

export const membershipApplicationsTable = pgTable(
  "membership_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Public reference, e.g. ANT-2026-0001 (via allocateDocRef). */
    antragsnummer: text("antragsnummer").notNull(),
    antragstyp: antragTypEnum("antragstyp").notNull().default("einzel"),
    status: antragStatusEnum("status").notNull().default("neu"),
    source: antragSourceEnum("source").notNull().default("online"),
    mitgliedschaftTyp: mitgliedschaftTypEnum("mitgliedschaft_typ").notNull(),

    // Contact person: applicant for einzel/familie, the child for kind.
    geschlecht: geschlechtEnum("geschlecht"),
    vorname: text("vorname").notNull(),
    nachname: text("nachname").notNull(),
    geburtsdatum: timestamp("geburtsdatum", { withTimezone: false }).notNull(),
    strasse: text("strasse"),
    hausnummer: text("hausnummer"),
    plz: text("plz"),
    ort: text("ort"),
    telefon: text("telefon"),
    email: text("email"),

    // Guardian (kind only).
    erziehungsberechtigterVorname: text("erziehungsberechtigter_vorname"),
    erziehungsberechtigterNachname: text("erziehungsberechtigter_nachname"),

    // Partner / second parent (familie only).
    partnerVorname: text("partner_vorname"),
    partnerNachname: text("partner_nachname"),
    partnerGeburtsdatum: timestamp("partner_geburtsdatum", { withTimezone: false }),
    partnerAbteilungen: jsonb("partner_abteilungen").$type<string[]>(),

    // Children (familie only). Each entry carries its own Abteilung ids.
    kinder: jsonb("kinder").$type<AntragKind[]>(),

    /** Abteilung ids the applicant joins. */
    abteilungen: jsonb("abteilungen").$type<string[]>().notNull().default([]),
    elternteilMitglied: boolean("elternteil_mitglied").notNull().default(false),
    jahresbeitrag: numeric("jahresbeitrag", { precision: 19, scale: 2 }),
    /**
     * Beitragsart matched for this application's role at submit time (via the
     * Beitragsart-Zuordnung), so approval can pre-select it. Null when the quote
     * came from the Beitragsstaffel and no Beitragsart was tagged.
     */
    vorgeschlageneArt: integer("vorgeschlagene_art"),

    // SEPA. IBAN is AES-256-GCM encrypted; last 4 kept in plaintext for display.
    kontoinhaber: text("kontoinhaber"),
    iban: encryptedText("iban"),
    ibanLast4: text("iban_last4"),
    bic: text("bic"),
    kreditinstitut: text("kreditinstitut"),
    mandatsreferenz: text("mandatsreferenz"),

    notes: text("notes"),
    adminDeclineReason: text("admin_decline_reason"),
    /** Minted member number, written back on approval. */
    mitgliedsnummer: text("mitgliedsnummer"),
    /** The member created from this application (set on approval). */
    memberId: uuid("member_id").references(() => membersTable.id, { onDelete: "set null" }),

    consentAt: timestamp("consent_at", { withTimezone: true }),
    datenschutzAccepted: boolean("datenschutz_accepted"),
    satzungAccepted: boolean("satzung_accepted"),
    consentIp: text("consent_ip"),

    emailSent: boolean("email_sent").notNull().default(false),
    isTest: boolean("is_test").notNull().default(false),
    /**
     * When set, the application is archived: kept for the record but hidden from
     * the default Anträge list. Reversible (unarchive clears it). Independent of
     * `status` so a genehmigt/abgelehnt application can be tidied away without
     * losing its outcome.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("membership_applications_antragsnummer_uk").on(t.antragsnummer),
    index("membership_applications_status_idx").on(t.status, t.createdAt),
    index("membership_applications_name_idx").on(t.nachname, t.vorname),
    index("membership_applications_email_idx").on(t.email),
    index("membership_applications_archived_idx").on(t.archivedAt),
  ],
);

export const antragTokenPurposeEnum = pgEnum("antrag_token_purpose", ["upload"]);

/**
 * One-shot, hashed token granting a public action on an application without a
 * login -- specifically the 30-day "return the signed paper form" upload link.
 * Mirrors `portal_tokens`: `tokenHash` is the SHA-256 of the raw token, the
 * raw token never lives in the database.
 */
export const membershipApplicationTokensTable = pgTable(
  "membership_application_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => membershipApplicationsTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: antragTokenPurposeEnum("purpose").notNull().default("upload"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("membership_application_tokens_hash_uk").on(t.tokenHash),
    index("membership_application_tokens_app_idx").on(t.applicationId),
  ],
);

export const antragFileKindEnum = pgEnum("antrag_file_kind", [
  "generated_pdf",
  "signed_scan",
  "approved_pdf",
  "signature_image",
]);

/**
 * Files attached to an application, stored in S3 (key in `s3Key`). Kept off
 * the member-scoped `attachments` table because an application has no member
 * row until approval and `/api/files/$id` gates downloads on an authed session.
 */
export const membershipApplicationFilesTable = pgTable(
  "membership_application_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => membershipApplicationsTable.id, { onDelete: "cascade" }),
    kind: antragFileKindEnum("kind").notNull(),
    s3Key: text("s3_key").notNull(),
    filename: text("filename"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("membership_application_files_app_idx").on(t.applicationId)],
);

export type MembershipApplication = typeof membershipApplicationsTable.$inferSelect;
export type MembershipApplicationToken = typeof membershipApplicationTokensTable.$inferSelect;
export type MembershipApplicationFile = typeof membershipApplicationFilesTable.$inferSelect;
export type AntragStatus = (typeof antragStatusEnum.enumValues)[number];
export type AntragTyp = (typeof antragTypEnum.enumValues)[number];
export type MitgliedschaftTyp = (typeof mitgliedschaftTypEnum.enumValues)[number];
