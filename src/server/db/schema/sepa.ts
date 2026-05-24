import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Linear Webverein `adrsepa` (SEPA-Mandate). Composite Linear key
 * `(AdrNr, MandatsNr)` is preserved as a unique index.
 */
export const sepaMandatesTable = pgTable(
  "sepa_mandates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    adrNr: integer("adr_nr").notNull(),
    mandatsNr: text("mandats_nr").notNull(),
    mandKey: text("mand_key"),
    lastschriftart: text("lastschriftart"),
    typ: text("typ"),
    status: text("status"),
    angelegtAm: timestamp("angelegt_am"),
    gultigBis: timestamp("gultig_bis"),
    unterschriftDatum: timestamp("unterschrift_datum"),
    ersteVerwendung: timestamp("erste_verwendung"),
    letzteVerwendung: timestamp("letzte_verwendung"),
    widerrufenAm: timestamp("widerrufen_am"),
    gueltigAb: timestamp("gueltig_ab"),
    letzteVerwendungAlt: timestamp("letzte_verwendung_alt"),
    gultigBisAlt: timestamp("gultig_bis_alt"),
    isDeleted: boolean("is_deleted").default(false),
    importBatchId: uuid("import_batch_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sepa_adrnr_mandatsnr_uk").on(t.adrNr, t.mandatsNr),
    index("sepa_member_idx").on(t.memberId),
  ],
);

export type SepaMandate = typeof sepaMandatesTable.$inferSelect;
