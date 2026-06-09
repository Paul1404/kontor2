import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { encryptedText } from "~/server/db/types";

/**
 * Explicit gender column (independent of Anrede). Linear's UI uses a similar
 * picklist; storing it separately means we don't lose people whose Anrede is
 * a title ("Dr.", "Prof.") or non-binary form.
 */
export const geschlechtEnum = pgEnum("geschlecht", ["m", "w", "d", "unbekannt"]);

/**
 * Normalized member lifecycle status. Replaces the legacy signals (`aktiv_pasiv`
 * text flag plus the `austritt` / `verstorben_am` dates) with one value derived
 * by `deriveStatus`. Stored, not generated: the importer sets it at the
 * translation boundary and the app keeps it in sync, so it survives the
 * eventual removal of the legacy source columns.
 */
export const memberStatusEnum = pgEnum("member_status", [
  "aktiv",
  "passiv",
  "ausgetreten",
  "verstorben",
]);

/**
 * Member table. Started as a lossless mirror of Linear Webverein's `adresse`
 * table; the ~106 never-read legacy columns have been dropped, leaving the
 * fields the app actually uses plus the clean, normalized columns
 * (`mitgliedsnummer`, `email`, `status`, `dunning_blocked`).
 *
 * Internal `id` is a generated UUID; the Linear `AdrNr` is preserved as a
 * non-null unique integer. IBAN columns are AES-256-GCM encrypted at rest via
 * the `encryptedText` type. The remaining legacy text columns (e.g. `mitgliedsnummer`,
 * `e_mail_name`, `aktiv_pasiv`, `mahn_sperre`) are being read off in favour of
 * the clean columns and will be dropped once the edit form and importer no
 * longer reference them.
 */
export const membersTable = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    notes: text("notes"),
    geschlecht: geschlechtEnum("geschlecht"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
    importBatchId: uuid("import_batch_id"),
    adrNr: integer("adr_nr").notNull(),
    firma1: text("firma1"),
    kurzname: text("kurzname"),
    anrede: text("anrede"),
    vorname: text("vorname"),
    nachname: text("nachname"),
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    telefon1: text("telefon1"),
    telefon2: text("telefon2"),
    funktion: text("funktion"),
    geburtsdatum: timestamp("geburtsdatum", { withTimezone: false }),
    // Custom legal representative (gesetzliche Vertretung) for minors, used as
    // the Mahnung recipient when no connection is flagged as Vertreter. Free
    // text so it works for guardians who are not themselves in the system.
    vertreterAnrede: text("vertreter_anrede"),
    vertreterName: text("vertreter_name"),
    vertreterStrasse: text("vertreter_strasse"),
    vertreterHausnummer: text("vertreter_hausnummer"),
    vertreterPlz: text("vertreter_plz"),
    vertreterOrt: text("vertreter_ort"),
    eintritt: timestamp("eintritt", { withTimezone: false }),
    austritt: timestamp("austritt", { withTimezone: false }),
    abwKontoInh: text("abw_konto_inh"),
    abteilung: text("abteilung"),
    verstorbenAm: timestamp("verstorben_am", { withTimezone: false }),
    titel1: text("titel1"),
    geburtsort: text("geburtsort"),
    land: text("land"),
    spender: text("spender"),
    iban1: encryptedText("iban1"),
    iban1Last4: text("iban1_last4"),
    bic1: text("bic1"),
    hausnummer: text("hausnummer"),
    adresszusatz: text("adresszusatz"),
    www: text("www"),
    // --- App-owned identifiers ----------------------------------------------
    // `member_no` / `kontakt_no` are the app's own opaque numbers (M-XXXXXX /
    // K-XXXXXX), minted by `~/server/domain/member-number`. A live row carries
    // exactly one: real members get `member_no`, non-member contacts/payers get
    // `kontakt_no`. `coalesce(member_no, kontakt_no)` is the user-facing
    // reference and the route key. See `~/server/domain/member#memberRef`.
    /** Opaque app-owned member number (M-...). Null for contacts. */
    memberNo: text("member_no"),
    /** Opaque app-owned contact number (K-...). Null for members. */
    kontaktNo: text("kontakt_no"),
    // --- Clean, app-owned columns (Phase 1) ---------------------------------
    // These hold the normalized shape produced by `translateLinearMember`.
    /**
     * Preserved legacy Linear member number (`MITGLNR`). No longer the primary
     * identifier -- it is kept searchable so references on old Mahnungen and
     * payments stay resolvable during the transition. The importer keeps writing
     * this column from Linear; the app-owned number lives in `member_no`.
     */
    mitgliedsnummer: text("mitgliedsnummer"),
    /** Clean name for `e_mail_name`, with the legacy `telefon3` fallback. */
    email: text("email"),
    /** Normalized lifecycle status (was `aktiv_pasiv` + the exit/death dates). */
    status: memberStatusEnum("status"),
    /** Normalized dunning block (was the free-form `mahn_sperre` text flag). */
    dunningBlocked: boolean("dunning_blocked").notNull().default(false),
    /**
     * Suspends SEPA direct debit for this member: the Beitragslauf skips them
     * (reason "Einzug ausgesetzt") until cleared. Separate from
     * `dunningBlocked`, which only pauses Mahnungen. Use for disputed amounts,
     * a member who switched to Überweisung, or a temporary hold.
     */
    directDebitBlocked: boolean("direct_debit_blocked").notNull().default(false),
    /**
     * Ruhende Mitgliedschaft: temporarily paused. The member stays a member
     * (still counts in the Bestandserhebung and the active total) but the
     * Beitragslauf skips them (reason "Ruhend") until the pause is lifted. Use
     * for a sabbatical, a long illness, or a season out.
     */
    ruhend: boolean("ruhend").notNull().default(false),
    /**
     * Beitragsbefreiung: exempt from membership fees. The member counts fully
     * everywhere, but the Beitragslauf raises no Sollstellung for them (reason
     * "Beitragsbefreit"). Distinct from a 0-Euro contract: a deliberate
     * member-level status, independent of the contract amount.
     */
    beitragsbefreit: boolean("beitragsbefreit").notNull().default(false),
  },
  (t) => [
    uniqueIndex("members_adr_nr_uk").on(t.adrNr),
    // Partial unique: a soft-deleted row frees its number for reuse (v0.18.0).
    uniqueIndex("members_member_no_uk").on(t.memberNo).where(sql`${t.deletedAt} is null`),
    uniqueIndex("members_kontakt_no_uk").on(t.kontaktNo).where(sql`${t.deletedAt} is null`),
    index("members_nachname_vorname_idx").on(t.nachname, t.vorname),
    index("members_plz_idx").on(t.plz),
    index("members_austritt_idx").on(t.austritt),
    index("members_eintritt_idx").on(t.eintritt),
    index("members_mitgliedsnummer_idx").on(t.mitgliedsnummer),
    index("members_status_idx").on(t.status),
  ],
);

export type Member = typeof membersTable.$inferSelect;
export type NewMember = typeof membersTable.$inferInsert;
