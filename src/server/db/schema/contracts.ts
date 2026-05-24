import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Linear Webverein `mgvert` (Verträge / contracts). Composite Linear key
 * (AdrNr, VertragNr, Art) is preserved as a unique index; we additionally
 * resolve `AdrNr` to our internal `memberId`.
 */
export const contractsTable = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    adrNr: integer("adr_nr").notNull(),
    vertragNr: text("vertrag_nr").notNull(),
    art: integer("art").notNull(),
    artName: text("art_name"),
    mitglNr: text("mitgl_nr"),
    sollstellung: text("sollstellung"),
    vertragBegin: timestamp("vertrag_begin"),
    vertragEnde: timestamp("vertrag_ende"),
    aufnahmegeb: numeric("aufnahmegeb", { precision: 19, scale: 8 }),
    betrag: numeric("betrag", { precision: 19, scale: 8 }),
    kuendAnzahl: integer("kuend_anzahl"),
    keundZeitraum: text("keund_zeitraum"),
    keundBis: text("keund_bis"),
    gekuendAm: timestamp("gekuend_am"),
    gekuendZum: timestamp("gekuend_zum"),
    frueGekuendAm: timestamp("frue_gekuend_am"),
    frueGekuendZum: timestamp("frue_gekuend_zum"),
    autoVerlZahl: integer("auto_verl_zahl"),
    autoVerlZeit: text("auto_verl_zeit"),
    aufRechnung: text("auf_rechnung"),
    anteilig: text("anteilig"),
    multipl: integer("multipl"),
    steuer: text("steuer"),
    abwAdrNr: integer("abw_adr_nr"),
    verwZw1: text("verw_zw1"),
    verwZw2: text("verw_zw2"),
    verwZw3: text("verw_zw3"),
    verwZw4: text("verw_zw4"),
    lastschrift: text("lastschrift"),
    blzV: text("blz_v"),
    bankV: text("bank_v"),
    kontoV: text("konto_v"),
    ktoInhV: text("kto_inh_v"),
    monatAb: integer("monat_ab"),
    rgNr: integer("rg_nr"),
    prenotifikation: text("prenotifikation"),
    abwKontoInh: text("abw_konto_inh"),
    strasseKih: text("strasse_kih"),
    plzKih: text("plz_kih"),
    ortKih: text("ort_kih"),
    emailKih: text("email_kih"),
    falligkeitDatum1: timestamp("falligkeit_datum1"),
    falligkeitDatum2: timestamp("falligkeit_datum2"),
    falligkeitDatum3: timestamp("falligkeit_datum3"),
    falligkeitDatum4: timestamp("falligkeit_datum4"),
    falligkeitTag: integer("falligkeit_tag"),
    importBatchId: uuid("import_batch_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contracts_adrnr_vertragnr_art_uk").on(t.adrNr, t.vertragNr, t.art),
    index("contracts_member_idx").on(t.memberId),
  ],
);

export type Contract = typeof contractsTable.$inferSelect;
