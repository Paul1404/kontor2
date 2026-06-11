import { sql } from "drizzle-orm";
import {
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Familienmitgliedschaft als eigenes Konzept.
 *
 * Bisher existierte "Familie" nur implizit: ein Mitglied hält den
 * Familienbeitrag (Beitragsart 101), Partner und Kinder sind beitragsfreie
 * Mitglieder ohne Vertrag, verbunden höchstens über unbeschriftete
 * Linear-Verknüpfungen und eine gemeinsame Adresse. Diese Tabellen machen die
 * Gruppe explizit: wer gehört zusammen, wer zahlt, in welcher Rolle.
 *
 * Bewusst unabhängig von der Beitragsart: eine Familie existiert auch, wenn
 * (noch) kein Familienbeitrag läuft. Der Seed-Assistent schlägt Gruppen aus
 * Familienbeitrag + Verknüpfungen + Adresse vor; bestätigt wird von Hand.
 */
export const familienRolleEnum = pgEnum("familien_rolle", ["zahler", "partner", "kind"]);

export const familienTable = pgTable("familien", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Anzeigename, z. B. "Familie Brückner". */
  name: text("name").notNull(),
  /**
   * Wer die Beiträge der Familie trägt. Restrict statt cascade: der Zahler
   * muss erst aus der Familie gelöst werden, bevor sein Datensatz hart
   * gelöscht werden kann (Soft-Delete ist davon unberührt).
   */
  zahlerMemberId: uuid("zahler_member_id").references(() => membersTable.id, {
    onDelete: "restrict",
  }),
  notiz: text("notiz"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const familienMitgliederTable = pgTable(
  "familien_mitglieder",
  {
    // Surrogat-PK statt (familieId, memberId): eine beendete Zugehörigkeit
    // bleibt als Verlaufszeile stehen und darf einen späteren Wiedereintritt
    // in dieselbe Familie nicht blockieren.
    id: uuid("id").primaryKey().defaultRandom(),
    familieId: uuid("familie_id")
      .notNull()
      .references(() => familienTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    rolle: familienRolleEnum("rolle").notNull(),
    /** Zugehörigkeit mit Verlauf: `bis` gesetzt = ausgeschieden (z. B. Kind ab 18). */
    von: date("von"),
    bis: date("bis"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Ein Mitglied gehört zu höchstens EINER aktiven Familie. Beendete
    // Zugehörigkeiten (bis gesetzt) blockieren einen Neueintritt nicht.
    uniqueIndex("familien_mitglieder_active_member_uk").on(t.memberId).where(sql`bis is null`),
    index("familien_mitglieder_familie_idx").on(t.familieId),
  ],
);

export type Familie = typeof familienTable.$inferSelect;
export type FamilienMitglied = typeof familienMitgliederTable.$inferSelect;
export type FamilienRolle = (typeof familienRolleEnum.enumValues)[number];
