import {
  boolean,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

export const abteilungenTable = pgTable("abteilungen", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  // Sportart + Verbandsname mirror the Linear "Abteilung/Sparte" table
  // (e.g. Sportart "Fußball", Verband "Bayerischer Fußball-Verband e.V.").
  // Both are optional because not every Abteilung is sportlich (Förderkreis etc.).
  sportart: text("sportart"),
  verbandName: text("verband_name"),
  verbandNr: text("verband_nr"),
  inaktiv: boolean("inaktiv").notNull().default(false),
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
