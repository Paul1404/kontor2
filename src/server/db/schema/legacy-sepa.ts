import {
  decimal,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Historical SEPA runs imported from Linear `lastprot`. Stand-alone (does
 * not feed `fee_runs`): the active Beitragslauf workflow expects mandates
 * + contracts that are still in scope, while Linear's archive may reference
 * data that has since been deleted or migrated. Mirrors the dump 1:1; the
 * raw `xml_data` blob is preserved so a Vorstand can reconstruct exactly
 * what was submitted to the bank.
 */
export const legacySepaRunsTable = pgTable(
  "legacy_sepa_runs",
  {
    id: integer("id").primaryKey(),
    datum: timestamp("datum", { withTimezone: false }).notNull(),
    falligkeitsdatum: timestamp("falligkeitsdatum", { withTimezone: false }),
    benutzer: text("benutzer").notNull(),
    guid: text("guid").notNull(),
    xmlName: text("xml_name").notNull(),
    xmlData: text("xml_data"),
    /** `false` for `lastprot` (active history), `true` for `lastproth` (purged journal). */
    archived: text("archived").notNull().default("false"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("legacy_sepa_runs_guid_idx").on(t.guid)],
);

/**
 * Per-Sollstellung items inside a `legacy_sepa_runs` row, imported from
 * Linear `lastprots`. `sollGuid` joins against `soll_stellungen.linear_guid`
 * if the matching Sollstellung was also imported.
 */
export const legacySepaRunItemsTable = pgTable(
  "legacy_sepa_run_items",
  {
    sepaGuid: text("sepa_guid").notNull(),
    sollGuid: text("soll_guid").notNull(),
    betrag: decimal("betrag", { precision: 19, scale: 8 }),
    offen: decimal("offen", { precision: 19, scale: 8 }),
    ruckLastGuid: text("ruck_last_guid"),
    archived: text("archived").notNull().default("false"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sepaGuid, t.sollGuid] }),
    index("legacy_sepa_run_items_soll_idx").on(t.sollGuid),
  ],
);

export type LegacySepaRun = typeof legacySepaRunsTable.$inferSelect;
export type LegacySepaRunItem = typeof legacySepaRunItemsTable.$inferSelect;
