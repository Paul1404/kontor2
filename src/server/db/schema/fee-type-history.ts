import { date, decimal, integer, pgTable, primaryKey } from "drizzle-orm/pg-core";

/**
 * Per-month effective price for a Beitragsart, imported from Linear
 * `mgartdat`. The current `fee_types.betrag1` only carries the latest value;
 * this table preserves the price-change history so reports can resolve
 * "what did Beitragsart 100 cost in March 2018?" without guessing.
 */
export const feeTypePriceHistoryTable = pgTable(
  "fee_type_price_history",
  {
    art: integer("art").notNull(),
    jahr: integer("jahr").notNull(),
    monat: integer("monat").notNull(),
    betrag: decimal("betrag", { precision: 19, scale: 8 }),
    prozent: decimal("prozent", { precision: 19, scale: 8 }),
    datum: date("datum"),
  },
  (t) => [primaryKey({ columns: [t.art, t.jahr, t.monat] })],
);

export type FeeTypePriceHistory = typeof feeTypePriceHistoryTable.$inferSelect;
