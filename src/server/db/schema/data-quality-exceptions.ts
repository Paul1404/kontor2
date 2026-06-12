import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * "Geprüft" / Ausnahme für einen Datenqualitäts-Befund: ein Vorstand hat einen
 * Treffer angesehen und als bewusst in Ordnung markiert (z. B. zahlt über die
 * Familie, beitragsfrei, bewusst so). Der Befund verschwindet damit aus der
 * aktiven Liste, der Zählung, dem CSV-Export und der nächtlichen Aufgaben-
 * Erzeugung, bleibt aber nachvollziehbar und lässt sich wieder aufnehmen.
 *
 * Granularität ist (Prüfung, Mitglied) -- dieselbe Auflösung, die der Operator
 * in der Befundliste sieht. `category` ist eine der festen CategoryIds aus
 * `data-quality.ts`.
 */
export const dataQualityExceptionsTable = pgTable(
  "data_quality_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dq_exceptions_category_member_uk").on(t.category, t.memberId),
    index("dq_exceptions_member_idx").on(t.memberId),
  ],
);

export type DataQualityException = typeof dataQualityExceptionsTable.$inferSelect;
