import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { encryptedText } from "~/server/db/types";

/**
 * Single-row SMTP / MTA configuration. The Admin sets host, port, credentials,
 * and from-address through the UI; password is AES-256-GCM encrypted at rest.
 * `id` is constrained to literal `1` (CHECK constraint added via SQL migration).
 */
export const smtpConfigTable = pgTable("smtp_config", {
  id: integer("id").primaryKey().notNull().default(1),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  secure: boolean("secure").notNull().default(true),
  username: text("username"),
  passwordEncrypted: encryptedText("password_encrypted"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type SmtpConfig = typeof smtpConfigTable.$inferSelect;
