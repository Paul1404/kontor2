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
 * the `encryptedText` type. The remaining legacy text columns (e.g. `mitglnr`,
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
    firma2: text("firma2"),
    firma3: text("firma3"),
    firma4: text("firma4"),
    kurzname: text("kurzname"),
    anrede: text("anrede"),
    vorname: text("vorname"),
    nachname: text("nachname"),
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    telefon1: text("telefon1"),
    telefon2: text("telefon2"),
    fax: text("fax"),
    erfDatum: timestamp("erf_datum", { withTimezone: false }),
    letztKontakt: timestamp("letzt_kontakt", { withTimezone: false }),
    widervorlage: timestamp("widervorlage", { withTimezone: false }),
    benutzer: text("benutzer"),
    bank1: text("bank1"),
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
    bank: text("bank"),
    blz: text("blz"),
    landname: text("landname"),
    mahnSperre: text("mahn_sperre"),
    lastschrift: text("lastschrift"),
    mitglnr: text("mitglnr"),
    jahr: integer("jahr"),
    aktiv: text("aktiv"),
    abwKontoInh: text("abw_konto_inh"),
    aktivPasiv: text("aktiv_pasiv"),
    telefon3: text("telefon3"),
    abteilung: text("abteilung"),
    mitglied: text("mitglied"),
    geborene: text("geborene"),
    genannt: text("genannt"),
    namensvorsatz: text("namensvorsatz"),
    namenszusatz: text("namenszusatz"),
    verstorbenAm: timestamp("verstorben_am", { withTimezone: false }),
    titel1: text("titel1"),
    titel2: text("titel2"),
    geburtsort: text("geburtsort"),
    eMailName: text("e_mail_name"),
    haus: text("haus"),
    land: text("land"),
    gesperrt: text("gesperrt"),
    spender: text("spender"),
    iban1: encryptedText("iban1"),
    iban1Last4: text("iban1_last4"),
    iban2: encryptedText("iban2"),
    iban3: encryptedText("iban3"),
    bic1: text("bic1"),
    adrNrKih: integer("adr_nr_kih"),
    mandatsrefenz: text("mandatsrefenz"),
    hausnummer: text("hausnummer"),
    strasseKih: text("strasse_kih"),
    plzKih: text("plz_kih"),
    ortKih: text("ort_kih"),
    emailKih: text("email_kih"),
    adresszusatz: text("adresszusatz"),
    www: text("www"),
    geburtsname: text("geburtsname"),
    geloscht: boolean("geloscht"),
    // --- Clean, app-owned columns (Phase 1) ---------------------------------
    // These hold the normalized shape produced by `translateLinearMember`.
    // They are backfilled from the legacy columns above and coexist with them
    // until consumers are cut over; nothing reads them yet. See
    // `~/server/domain/member` for the canonical derivations.
    /** Clean name for the legacy `mitglnr`. The human-readable member number. */
    mitgliedsnummer: text("mitgliedsnummer"),
    /** Clean name for `e_mail_name`, with the legacy `telefon3` fallback. */
    email: text("email"),
    /** Normalized lifecycle status (was `aktiv_pasiv` + the exit/death dates). */
    status: memberStatusEnum("status"),
    /** Normalized dunning block (was the free-form `mahn_sperre` text flag). */
    dunningBlocked: boolean("dunning_blocked").notNull().default(false),
  },
  (t) => [
    uniqueIndex("members_adr_nr_uk").on(t.adrNr),
    index("members_mitglnr_idx").on(t.mitglnr),
    index("members_nachname_vorname_idx").on(t.nachname, t.vorname),
    index("members_email_name_idx").on(t.eMailName),
    index("members_plz_idx").on(t.plz),
    index("members_austritt_idx").on(t.austritt),
    index("members_eintritt_idx").on(t.eintritt),
    index("members_geloscht_idx").on(t.geloscht),
    index("members_mitgliedsnummer_idx").on(t.mitgliedsnummer),
    index("members_status_idx").on(t.status),
  ],
);

export type Member = typeof membersTable.$inferSelect;
export type NewMember = typeof membersTable.$inferInsert;
