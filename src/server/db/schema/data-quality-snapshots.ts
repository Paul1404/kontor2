import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Per-day count of every data-quality rule, written by the nightly job
 * (issue #81). One row per (snapshot_date, rule_id) so a bad import shows up as
 * a next-morning spike in the "Datenqualität über Zeit" trend on the dashboard.
 * The unique index makes the writer idempotent: a re-run on the same day
 * upserts the count instead of duplicating the row.
 */
export const dataQualitySnapshotsTable = pgTable(
  "data_quality_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: date("snapshot_date").notNull(),
    ruleId: text("rule_id").notNull(),
    severity: text("severity").notNull(),
    count: integer("count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dq_snapshots_date_rule_uk").on(t.snapshotDate, t.ruleId),
    index("dq_snapshots_date_idx").on(t.snapshotDate),
  ],
);

export type DataQualitySnapshot = typeof dataQualitySnapshotsTable.$inferSelect;
