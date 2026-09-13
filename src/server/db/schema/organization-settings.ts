import { boolean, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { TenantPolicy } from "~/lib/tenant-settings";
import { users } from "~/server/db/schema/auth";
import { encryptedText } from "~/server/db/types";

/**
 * Age-bucket annual fees for the online membership application
 * (Beitragsstaffel). Amounts are euro decimal strings. `kind` and `jugendlich`
 * have two rates depending on whether a parent is already a member; the other
 * categories have a single rate. Defaults mirror the legacy svums schedule.
 */
export type Beitragsstaffel = {
  familie: string;
  kind: string;
  kindElternMitglied: string;
  jugendlich: string;
  jugendlichElternMitglied: string;
  jungerErwachsener: string;
  erwachsener: string;
};

/** Historical SVU fixture. Runtime requests always use persisted tenant settings. */
export const LEGACY_SVU_BEITRAGSSTAFFEL: Beitragsstaffel = {
  familie: "96.00",
  kind: "24.00",
  kindElternMitglied: "12.00",
  jugendlich: "36.00",
  jugendlichElternMitglied: "24.00",
  jungerErwachsener: "42.00",
  erwachsener: "54.00",
};

/**
 * Vereins-Stammdaten (singleton row, id = 1). Holds the data required to
 * generate pain.008 SEPA direct-debit XML: creditor identity, bank account,
 * and default Fälligkeitstag. IBAN is AES-256-GCM encrypted; the last 4
 * digits are kept in plaintext for display and audit-diff masking.
 *
 * The Linear pendant is the `mandstam` table (single row), which we do not
 * import automatically -- Vorstand fills this in once via the settings UI.
 */
export const organizationSettingsTable = pgTable("organization_settings", {
  id: integer("id").primaryKey().notNull().default(1),
  vereinsname: text("vereinsname").notNull(),
  /**
   * White-Label: kurzer Anzeigename für die Oberfläche (Kopfzeile, Login,
   * Browser-Tab), z. B. "SV Untereuerheim". `vereinsname` bleibt der volle
   * rechtliche Name für SEPA und Briefe. Leer: es wird auf `vereinsname`
   * zurückgegriffen.
   */
  anzeigename: text("anzeigename"),
  /** Logo als data-URI (PNG/SVG), zeigt überall in der App. Leer: gebündeltes Standard-Logo. */
  logo: text("logo"),
  /** Markenfarbe als Hex (#rrggbb). Färbt Primär-/Brand-Elemente. Leer: Standardrot. */
  primaryColor: text("primary_color"),
  /** Tenant-specific workflow and legacy-source policy. Null until explicitly configured. */
  tenantPolicy: jsonb("tenant_policy").$type<TenantPolicy>(),
  anschriftStrasse: text("anschrift_strasse"),
  anschriftPlz: text("anschrift_plz"),
  anschriftOrt: text("anschrift_ort"),
  anschriftLand: text("anschrift_land").notNull().default("DE"),
  glaeubigerId: text("glaeubiger_id").notNull(),
  vereinsIban: encryptedText("vereins_iban").notNull(),
  vereinsIbanLast4: text("vereins_iban_last4").notNull(),
  vereinsBic: text("vereins_bic").notNull(),
  vereinsBankname: text("vereins_bankname"),
  defaultFalligkeitTag: integer("default_falligkeit_tag").notNull().default(15),
  /**
   * Höchste genutzte Mahnstufe (1 bis 3). Ein Verein kann sein Mahnwesen auf
   * eine reine Erinnerung (1) oder Erinnerung + eine Mahnung (2) verkürzen.
   * Default 3 entspricht dem bisherigen dreistufigen Ablauf. Mahnläufe über
   * dieser Stufe werden abgelehnt.
   */
  maxMahnstufe: integer("max_mahnstufe").notNull().default(3),
  /** Mahngebühren je Stufe in Euro. 0 = keine Gebühr. */
  mahngebuhr1: numeric("mahngebuhr1", { precision: 19, scale: 2 }).notNull().default("0"),
  mahngebuhr2: numeric("mahngebuhr2", { precision: 19, scale: 2 }).notNull().default("5"),
  mahngebuhr3: numeric("mahngebuhr3", { precision: 19, scale: 2 }).notNull().default("10"),
  /**
   * Rücklastschriftgebühr für SEPA-Rückläufer. Dient zugleich als SEPA-Gebühr auf
   * dem Kulanz-Brief. Default 3,00 € entspricht dem üblichen Rücklastschrift-
   * entgelt der Banken; 0 schaltet die Gebühr ab.
   */
  sepaReturnFee: numeric("sepa_return_fee", { precision: 19, scale: 2 }).notNull().default("3.00"),
  /** Zahlungsfrist in Tagen ab Mahndatum. */
  mahnFristTage: integer("mahn_frist_tage").notNull().default(14),
  /**
   * Beitragsberechnung: "voll" = ganzer Jahresbeitrag unabhängig vom Ein-/
   * Austrittsdatum, "anteilig" = nach tatsächlichem Mitgliedszeitraum im
   * Abrechnungsjahr. Default "voll" entspricht dem bisherigen Verhalten.
   */
  beitragModus: text("beitrag_modus").notNull().default("voll"),
  /** Granularität der anteiligen Berechnung: "monat" oder "tag". */
  anteilEinheit: text("anteil_einheit").notNull().default("monat"),
  /**
   * Kündigungsfrist aktiv? Wenn false (Default), ist Ein- und Austritt zu
   * jedem beliebigen Datum erlaubt -- keine Fristprüfung.
   */
  kuendigungsfristAktiv: boolean("kuendigungsfrist_aktiv").notNull().default(false),
  /** Kündigungsfrist in Tagen ab heute (frühester Austrittstermin). 0 = sofort. */
  kuendigungsfristTage: integer("kuendigungsfrist_tage").notNull().default(0),
  /** Kündigung nur zum Monatsende zulässig. */
  kuendigungZumMonatsende: boolean("kuendigung_zum_monatsende").notNull().default(false),
  /**
   * Kontakt- und Rechtsangaben für Briefe (z. B. Austrittsbestätigung). Alle
   * optional; fehlende Werte werden im Dokument weggelassen.
   */
  kontaktEmail: text("kontakt_email"),
  /**
   * Postfach für Mitgliedschaftsangelegenheiten (z. B. mitgliedschaft@verein.de).
   * Hierhin gehen formlose Kündigungen aus dem Kulanz-Brief und der Kontakt auf
   * der Austrittsbestätigung. Leer: es wird auf `kontaktEmail` zurückgegriffen.
   */
  mitgliedschaftEmail: text("mitgliedschaft_email"),
  kontaktTelefon: text("kontakt_telefon"),
  datenschutzUrl: text("datenschutz_url"),
  satzungUrl: text("satzung_url"),
  /**
   * Präfix der SEPA-Mandatsreferenz, die beim Genehmigen eines Online-Antrags
   * vergeben wird (z. B. "SVU1945-"). Daraus wird `<prefix><jahr>-<nr>` gebaut.
   */
  mandatsreferenzPrefix: text("mandatsreferenz_prefix").notNull().default(""),
  /** Altersabhängige Jahresbeiträge für den Online-Aufnahmeantrag. */
  beitragsstaffel: jsonb("beitragsstaffel").$type<Beitragsstaffel>(),
  /**
   * Exklusive Altersgrenzen (Jahre, am Stichtag) für die Beitragskategorien des
   * Online-Antrags: bis zu dieser Grenze gilt die jeweilige Kategorie. Defaults
   * 14/18/25 entsprechen dem bisherigen Verhalten. Die Volljährigkeit (18,
   * gesetzliche Vertretung) ist davon unberührt und bleibt fest.
   */
  kategorieKindMaxAlter: integer("kategorie_kind_max_alter").notNull().default(14),
  kategorieJugendlichMaxAlter: integer("kategorie_jugendlich_max_alter").notNull().default(18),
  kategorieJungerErwachsenerMaxAlter: integer("kategorie_junger_erwachsener_max_alter")
    .notNull()
    .default(25),
  /** Bei neuem Online-Antrag eine Benachrichtigung an den Verein senden? */
  antragBenachrichtigungAktiv: boolean("antrag_benachrichtigung_aktiv").notNull().default(true),
  /**
   * Empfänger der Vereins-Benachrichtigung über neue Anträge. Leer: es wird auf
   * `mitgliedschaftEmail`, dann `kontaktEmail` zurückgegriffen.
   */
  antragVorstandEmail: text("antrag_vorstand_email"),
  /**
   * Bei jedem neu aufgenommenen Mitglied eine Benachrichtigung an den Vorstand
   * senden? Greift für die Antragsgenehmigung und die manuelle Neuanlage.
   */
  neumitgliedBenachrichtigungAktiv: boolean("neumitglied_benachrichtigung_aktiv")
    .notNull()
    .default(true),
  /**
   * Empfänger der Neumitglied-Benachrichtigung. Leer: es wird auf
   * `antragVorstandEmail`, dann `mitgliedschaftEmail`, dann `kontaktEmail`
   * zurückgegriffen.
   */
  neumitgliedVorstandEmail: text("neumitglied_vorstand_email"),
  /**
   * Gegenzeichnung des Vorstands für die Beitrittserklärung: ein PNG als
   * data-URI. Wird beim Genehmigen in das amtliche Antrags-PDF eingebettet.
   * Leer: das genehmigte PDF zeigt nur die Unterschrift des Antragstellers.
   */
  antragGegenzeichnungBild: text("antrag_gegenzeichnung_bild"),
  /** Name unter der Vorstands-Gegenzeichnung (z. B. "Max Mustermann, 1. Vorsitzender"). */
  antragGegenzeichnerName: text("antrag_gegenzeichner_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
