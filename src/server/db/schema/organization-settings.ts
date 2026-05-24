import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
