import { boolean, date, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";

/**
 * Persisted Verbandsmeldung / Bestandserhebung result for a given Stichtag.
 * The `breakdown` JSONB stores the full per-Abteilung × Geschlecht ×
 * Altersgruppe matrix as it was computed at archive time, so re-prints
 * down the line do not drift when members are mutated afterwards.
 */
export const bestandserhebungenTable = pgTable(
  "bestandserhebungen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stichtag: date("stichtag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdByEmail: text("created_by_email"),
    breakdown: jsonb("breakdown").$type<BestandserhebungBreakdown>().notNull(),
    signedOff: boolean("signed_off").notNull().default(false),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    signedOffBy: text("signed_off_by").references(() => users.id, { onDelete: "set null" }),
    signedOffByEmail: text("signed_off_by_email"),
    deliverableSha256: text("deliverable_sha256"),
    notes: text("notes"),
  },
  (t) => [
    index("bestandserhebungen_stichtag_idx").on(t.stichtag),
    index("bestandserhebungen_created_idx").on(t.createdAt),
  ],
);

export type BestandserhebungAgeBucket =
  | "0-6"
  | "7-14"
  | "15-18"
  | "19-26"
  | "27-40"
  | "41-60"
  | "61+"
  | "unbekannt";

export type BestandserhebungGender = "m" | "w" | "d" | "unbekannt";

/**
 * Per-cell count: members in this Abteilung × gender × age bucket.
 */
export type BestandserhebungCell = {
  abteilungId: string;
  abteilungName: string;
  sportart: string | null;
  verbandName: string | null;
  verbandNr: string | null;
  gender: BestandserhebungGender;
  ageBucket: BestandserhebungAgeBucket;
  count: number;
};

/**
 * Full snapshot stored alongside an archived Bestandserhebung. Includes
 * cell-level breakdown plus pre-computed per-Abteilung totals so the
 * sign-off PDF does not have to re-derive them.
 */
export type BestandserhebungBreakdown = {
  stichtag: string; // ISO date
  cells: BestandserhebungCell[];
  perAbteilung: Array<{
    abteilungId: string;
    abteilungName: string;
    sportart: string | null;
    verbandName: string | null;
    verbandNr: string | null;
    total: number;
    male: number;
    female: number;
    divers: number;
  }>;
  grandTotal: number;
};

export type BestandserhebungRecord = typeof bestandserhebungenTable.$inferSelect;
export type NewBestandserhebungRecord = typeof bestandserhebungenTable.$inferInsert;
