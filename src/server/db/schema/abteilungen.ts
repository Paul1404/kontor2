import { date, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

export const abteilungenTable = pgTable("abteilungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberAbteilungenTable = pgTable(
  "member_abteilungen",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    abteilungId: uuid("abteilung_id")
      .notNull()
      .references(() => abteilungenTable.id, { onDelete: "restrict" }),
    eintrittsdatum: date("eintrittsdatum").notNull(),
    austrittsdatum: date("austrittsdatum"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.abteilungId, t.eintrittsdatum] }),
    index("member_abteilungen_member_idx").on(t.memberId),
    index("member_abteilungen_abt_idx").on(t.abteilungId),
  ],
);

export type Abteilung = typeof abteilungenTable.$inferSelect;
export type MemberAbteilung = typeof memberAbteilungenTable.$inferSelect;
