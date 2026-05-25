import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/**
 * BLSV / DOSB sport-type catalogue, imported from Linear `sportarten`.
 * Static reference data; used as the picklist behind `abteilungen.sportart`.
 * Composite PK matches Linear's natural key (`KZ`, `NUMMER`, `LfdNr`).
 */
export const linearSportTypesTable = pgTable(
  "linear_sport_types",
  {
    kz: text("kz").notNull(),
    nummer: text("nummer").notNull(),
    sportart: text("sportart"),
    verbandNr: text("verband_nr"),
    lfdNr: integer("lfd_nr").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kz, t.nummer, t.lfdNr] })],
);

/**
 * Sport federation catalogue, imported from Linear `fachverbaende`. Used as
 * the picklist behind `abteilungen.verband_name`.
 */
export const linearFederationsTable = pgTable(
  "linear_federations",
  {
    kz: text("kz").notNull(),
    nummer: text("nummer").notNull(),
    fachverband: text("fachverband"),
    kn: text("kn"),
    lfdNr: integer("lfd_nr").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kz, t.nummer, t.lfdNr] })],
);

export type LinearSportType = typeof linearSportTypesTable.$inferSelect;
export type LinearFederation = typeof linearFederationsTable.$inferSelect;
