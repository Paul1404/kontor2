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
    anrede2: text("anrede2"),
    anredetitel: text("anredetitel"),
    vorname: text("vorname"),
    nachname: text("nachname"),
    strasse: text("strasse"),
    plz: text("plz"),
    ort: text("ort"),
    lkz: text("lkz"),
    vorwahl: text("vorwahl"),
    telefon1: text("telefon1"),
    telefon2: text("telefon2"),
    telefon4: text("telefon4"),
    fax: text("fax"),
    erfDatum: timestamp("erf_datum", { withTimezone: false }),
    letztKontakt: timestamp("letzt_kontakt", { withTimezone: false }),
    widervorlage: timestamp("widervorlage", { withTimezone: false }),
    strasseRech: text("strasse_rech"),
    plzRech: text("plz_rech"),
    ortRech: text("ort_rech"),
    strasseLief: text("strasse_lief"),
    plzLief: text("plz_lief"),
    ortLief: text("ort_lief"),
    strassePost: text("strasse_post"),
    plzPost: text("plz_post"),
    ortPost: text("ort_post"),
    benutzer: text("benutzer"),
    bank1: text("bank1"),
    blz1: text("blz1"),
    konto1: text("konto1"),
    bank2: text("bank2"),
    blz2: text("blz2"),
    konto2: text("konto2"),
    bank3: text("bank3"),
    blz3: text("blz3"),
    konto3: text("konto3"),
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
    benAender: text("ben_aender"),
    benBemerk: text("ben_bemerk"),
    benKontakt: text("ben_kontakt"),
    benWieder: text("ben_wieder"),
    eintritt: timestamp("eintritt", { withTimezone: false }),
    austritt: timestamp("austritt", { withTimezone: false }),
    bank: text("bank"),
    blz: text("blz"),
    kontoNr: text("konto_nr"),
    telefon5: text("telefon5"),
    telefon6: text("telefon6"),
    telefon7: text("telefon7"),
    landname: text("landname"),
    landKurzel: text("land_kurzel"),
    mahnSperre: text("mahn_sperre"),
    lastschrift: text("lastschrift"),
    mitglnr: text("mitglnr"),
    jahr: integer("jahr"),
    aktiv: text("aktiv"),
    abwKontoInh: text("abw_konto_inh"),
    kreditkarte: text("kreditkarte"),
    kreditkartenhalter: text("kreditkartenhalter"),
    kreditkartennummer: text("kreditkartennummer"),
    verfallsdatum: timestamp("verfallsdatum", { withTimezone: false }),
    kreditkartenname: text("kreditkartenname"),
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
    konto4: text("konto4"),
    blz4: text("blz4"),
    bank4: text("bank4"),
    konto5: text("konto5"),
    blz5: text("blz5"),
    bank5: text("bank5"),
    konto6: text("konto6"),
    blz6: text("blz6"),
    bank6: text("bank6"),
    bundesland: text("bundesland"),
    bild: text("bild"),
    haus: text("haus"),
    land: text("land"),
    co: text("co"),
    kartenNr1: text("karten_nr1"),
    kartenNr2: text("karten_nr2"),
    gesperrt: text("gesperrt"),
    spender: text("spender"),
    bezirk: text("bezirk"),
    stadtteil: text("stadtteil"),
    iban1: encryptedText("iban1"),
    iban1Last4: text("iban1_last4"),
    iban2: encryptedText("iban2"),
    iban3: encryptedText("iban3"),
    bic1: text("bic1"),
    bic2: text("bic2"),
    bic3: text("bic3"),
    vorwahl2: text("vorwahl2"),
    vorwahl3: text("vorwahl3"),
    vorwahl4: text("vorwahl4"),
    adrNrKih: integer("adr_nr_kih"),
    mandatsrefenz: text("mandatsrefenz"),
    hausnummer: text("hausnummer"),
    ausweisnummer: text("ausweisnummer"),
    gueltigkeitsdatum: timestamp("gueltigkeitsdatum", { withTimezone: false }),
    strasseKih: text("strasse_kih"),
    plzKih: text("plz_kih"),
    ortKih: text("ort_kih"),
    emailKih: text("email_kih"),
    adresszusatz: text("adresszusatz"),
    briefempfanger: text("briefempfanger"),
    briefanredeS: text("briefanrede_s"),
    www: text("www"),
    geburtsname: text("geburtsname"),
    vertBem: text("vert_bem"),
    postAnschriftPostfachStrasse: text("post_anschrift_postfach_strasse"),
    postAnschriftPostfachPlz: text("post_anschrift_postfach_plz"),
    postAnschriftPostfachOrt: text("post_anschrift_postfach_ort"),
    postAnschriftMemo1: text("post_anschrift_memo1"),
    postAnschriftStrasse: text("post_anschrift_strasse"),
    postAnschriftPlz: text("post_anschrift_plz"),
    postAnschriftOrt: text("post_anschrift_ort"),
    postAnschriftLand: text("post_anschrift_land"),
    postAnschriftMemo2: text("post_anschrift_memo2"),
    geloscht: boolean("geloscht"),
    freeText1: text("free_text1"),
    freeText2: text("free_text2"),
    freeText3: text("free_text3"),
    freeText4: text("free_text4"),
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
