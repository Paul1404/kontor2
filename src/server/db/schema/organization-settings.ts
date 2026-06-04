import { boolean, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { encryptedText } from "~/server/db/types";

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
  /** Mahngebühren je Stufe in Euro. 0 = keine Gebühr. */
  mahngebuhr1: numeric("mahngebuhr1", { precision: 19, scale: 2 }).notNull().default("0"),
  mahngebuhr2: numeric("mahngebuhr2", { precision: 19, scale: 2 }).notNull().default("5"),
  mahngebuhr3: numeric("mahngebuhr3", { precision: 19, scale: 2 }).notNull().default("10"),
  /** Optionale Rücklastschriftgebühr für SEPA-Rückläufer. */
  sepaReturnFee: numeric("sepa_return_fee", { precision: 19, scale: 2 }).notNull().default("0"),
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
