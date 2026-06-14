import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Uniqueness ledger for randomly generated document references.
 *
 * Unlike `document_sequences` (which hands out a running counter for the few
 * document types that must stay sequential, e.g. invoices), this table holds
 * one row per opaque, non-sequential reference like "ANT-2026-7K3QF9". The
 * reference body is random, so it carries no order or count information; the
 * primary key on `ref` is what guarantees no two documents collide. Allocation
 * generates a candidate and inserts it with `on conflict do nothing`, retrying
 * on the rare clash. See `~/server/db/doc-ref`.
 */
export const documentRefsTable = pgTable("document_refs", {
  /** The full reference, e.g. "ANT-2026-7K3QF9". Unique across all prefixes. */
  ref: text("ref").primaryKey(),
  /** Document type prefix, e.g. "ANT" (Antrag), "MA" (Mahnung). */
  prefix: text("prefix").notNull(),
  /** Calendar year embedded in the reference, for filtering and stats. */
  year: integer("year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocumentRef = typeof documentRefsTable.$inferSelect;
