import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { feeRunItemsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";

export const dunningRunStatusEnum = pgEnum("dunning_run_status", [
  "draft",
  "committed",
  "cancelled",
]);

export const dunningSentChannelEnum = pgEnum("dunning_sent_channel", [
  "pending",
  "email",
  "letter",
]);

/**
 * SEPA-Rückläufer. One row per failed direct debit. Linked to the original
 * `fee_run_items` so the open posting on the corresponding `soll_stellung`
 * can be reopened and -- optionally -- a Rücklastschriftgebühr can be
 * back-charged.
 *
 * `reasonCode` follows the camt.054 R-Transaction reason codes (AC04, AM04,
 * MD06, MS03, ...). Stored as plain text so future codes do not require a
 * migration.
 */
export const sepaReturnsTable = pgTable(
  "sepa_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feeRunItemId: uuid("fee_run_item_id")
      .notNull()
      .references(() => feeRunItemsTable.id, { onDelete: "restrict" }),
    // Soft pointer -- if the Sollstellung is later removed (cancelled run)
    // we keep the historical Rückläufer for compliance.
    sollStellungId: uuid("soll_stellung_id"),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "restrict" }),
    returnedOn: date("returned_on").notNull(),
    reasonCode: text("reason_code"),
    reasonText: text("reason_text"),
    rueckgebuhr: numeric("rueckgebuhr", { precision: 19, scale: 8 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("sepa_returns_member_idx").on(t.memberId, t.returnedOn),
    index("sepa_returns_item_idx").on(t.feeRunItemId),
    index("sepa_returns_returned_idx").on(t.returnedOn),
  ],
);

/**
 * Mahnlauf-Header. One row per batch of Mahnungen sent on the same day at
 * the same level. Detail rows live in `dunning_items`.
 */
export const dunningRunsTable = pgTable(
  "dunning_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 1 = Erinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung */
    level: integer("level").notNull(),
    status: dunningRunStatusEnum("status").notNull().default("draft"),
    runDate: date("run_date").notNull(),
    dueDate: date("due_date").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    totalOpen: numeric("total_open", { precision: 19, scale: 8 }).notNull().default("0"),
    totalFees: numeric("total_fees", { precision: 19, scale: 8 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("dunning_runs_status_idx").on(t.status, t.runDate),
    index("dunning_runs_date_idx").on(t.runDate),
  ],
);

/**
 * Per-recipient Mahnung. One row per (Mitglied, Mahnlauf). Aggregates the
 * member's offene Sollstellungen at the time of the run; the actual
 * Sollstellungs-IDs are stored in `sollIds` so the underlying postings can
 * be tracked back to this Mahnung.
 */
export const dunningItemsTable = pgTable(
  "dunning_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dunningRunId: uuid("dunning_run_id")
      .notNull()
      .references(() => dunningRunsTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "restrict" }),
    level: integer("level").notNull(),
    /** UUIDs of the involved soll_stellungen, JSON-encoded text array. */
    sollIdsJson: text("soll_ids_json").notNull().default("[]"),
    /** Posting items in the same JSON shape used for the PDF. */
    itemsJson: text("items_json").notNull().default("[]"),
    openSum: numeric("open_sum", { precision: 19, scale: 8 }).notNull(),
    mahngebuhr: numeric("mahngebuhr", { precision: 19, scale: 8 }).notNull().default("0"),
    totalDue: numeric("total_due", { precision: 19, scale: 8 }).notNull(),
    dueDate: date("due_date").notNull(),
    sentChannel: dunningSentChannelEnum("sent_channel").notNull().default("pending"),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    pdfFilename: text("pdf_filename"),
    pdfBase64: text("pdf_base64"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dunning_items_run_idx").on(t.dunningRunId),
    index("dunning_items_member_idx").on(t.memberId),
  ],
);

export type SepaReturn = typeof sepaReturnsTable.$inferSelect;
export type NewSepaReturn = typeof sepaReturnsTable.$inferInsert;
export type DunningRun = typeof dunningRunsTable.$inferSelect;
export type NewDunningRun = typeof dunningRunsTable.$inferInsert;
export type DunningItem = typeof dunningItemsTable.$inferSelect;
export type NewDunningItem = typeof dunningItemsTable.$inferInsert;
