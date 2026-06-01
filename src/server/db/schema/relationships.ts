import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { membersTable } from "~/server/db/schema/members";

/**
 * Linear Webverein `verkn` (Verknüpfungen) - directed link between two
 * addresses. Used for things like "Familienmitglied" and "Abweichender
 * Zahler". The Linear primary key is `(ADRNR, VERKN)`; we mirror it as a
 * unique index and additionally resolve both sides to internal `memberId`
 * when the targets exist in our `members` table.
 */
export const relationshipsTable = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromMemberId: uuid("from_member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    toMemberId: uuid("to_member_id").references(() => membersTable.id, {
      onDelete: "set null",
    }),
    fromAdrNr: integer("from_adr_nr").notNull(),
    toAdrNr: integer("to_adr_nr").notNull(),
    beziehung: text("beziehung"),
    matchcode: text("matchcode"),
    name: text("name"),
    anrede: text("anrede"),
    telefon: text("telefon"),
    abteilung: text("abteilung"),
    nachname: text("nachname"),
    art: text("art"),
    artName: text("art_name"),
    // Marks this connection as the member's legal representative / recipient
    // for official mail (e.g. Mahnungen for a minor). At most one per
    // from-member; the dunning workflow addresses the notice to this person
    // instead of the member when the member is under 18.
    istVertreter: boolean("ist_vertreter").notNull().default(false),
    rg: text("rg"),
    funktion: text("funktion"),
    post: text("post"),
    fax: text("fax"),
    email: text("email"),
    eb: text("eb"),
    vkennung: text("vkennung"),
    datVon: timestamp("dat_von", { withTimezone: false }),
    datBis: timestamp("dat_bis", { withTimezone: false }),
    vEmail: text("v_email"),
    kennungV1: text("kennung_v1"),
    kennungV2: text("kennung_v2"),
    kennungV3: text("kennung_v3"),
    kennungV4: text("kennung_v4"),
    kennungV5: text("kennung_v5"),
    notiz: text("notiz"),
    importBatchId: uuid("import_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("relationships_from_to_adrnr_uk").on(t.fromAdrNr, t.toAdrNr),
    index("relationships_from_member_idx").on(t.fromMemberId),
    index("relationships_to_member_idx").on(t.toMemberId),
  ],
);

export type Relationship = typeof relationshipsTable.$inferSelect;
export type NewRelationship = typeof relationshipsTable.$inferInsert;
