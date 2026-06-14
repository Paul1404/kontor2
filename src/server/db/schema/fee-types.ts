import { integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Linear Webverein `mgart` (Beitragsarten / fee types). Keyed by the
 * original `Art` smallint; full column set preserved.
 */
export const feeTypesTable = pgTable(
  "fee_types",
  {
    art: integer("art").notNull(),
    grundlage: text("grundlage"),
    sollstellung: text("sollstellung"),
    fibukonto: integer("fibukonto"),
    bezeichnung: text("bezeichnung"),
    valuta: text("valuta"),
    kontoname: text("kontoname"),
    steuer: text("steuer"),
    minBetrag: numeric("min_betrag", { precision: 19, scale: 8 }),
    maxBetrag: numeric("max_betrag", { precision: 19, scale: 8 }),
    feld: text("feld"),
    wert: text("wert"),
    anhArt: integer("anh_art"),
    anhBez: text("anh_bez"),
    edit: text("edit"),
    sollNichtErlaubt: text("soll_nicht_erlaubt"),
    spende: text("spende"),
    spendenvorlage: text("spendenvorlage"),
    koSt: integer("ko_st"),
    koTr: integer("ko_tr"),
    abteilung: text("abteilung"),
    eFeld: text("e_feld"),
    eMinBetrag: numeric("e_min_betrag", { precision: 19, scale: 8 }),
    eMaxBetrag: numeric("e_max_betrag", { precision: 19, scale: 8 }),
    eWert: text("e_wert"),
    eVerkn: text("e_verkn"),
    eProz: numeric("e_proz", { precision: 19, scale: 8 }),
    varField: text("var"),
    tBetrag1: numeric("t_betrag1", { precision: 19, scale: 8 }),
    tBetrag2: numeric("t_betrag2", { precision: 19, scale: 8 }),
    fibukonto1: integer("fibukonto1"),
    fibukonto2: integer("fibukonto2"),
    koSt1: integer("ko_st1"),
    koSt2: integer("ko_st2"),
    falligkeitDatum1: timestamp("falligkeit_datum1"),
    falligkeitDatum2: timestamp("falligkeit_datum2"),
    falligkeitDatum3: timestamp("falligkeit_datum3"),
    falligkeitDatum4: timestamp("falligkeit_datum4"),
    falligkeitTag: integer("falligkeit_tag"),
    koStG: integer("ko_st_g"),
    betrag1: numeric("betrag1", { precision: 19, scale: 8 }),
    nichAktiv: text("nich_aktiv"),
    artType: integer("art_type"),
    // Optional expected age range (completed years) for this Beitragsart. When
    // set, the data-quality check flags an active contract whose member is
    // outside [minAge, maxAge]. Both null = no age expectation (e.g. a
    // Förderbeitrag), the check skips it. Configured in the Beitragsarten admin.
    minAge: integer("min_age"),
    maxAge: integer("max_age"),
    importBatchId: text("import_batch_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fee_types_art_uk").on(t.art)],
);

export type FeeType = typeof feeTypesTable.$inferSelect;
