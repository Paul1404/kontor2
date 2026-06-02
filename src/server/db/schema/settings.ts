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
  requireTls: boolean("require_tls").notNull().default(true),
  allowInvalidCerts: boolean("allow_invalid_certs").notNull().default(false),
  username: text("username"),
  passwordEncrypted: encryptedText("password_encrypted"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type SmtpConfig = typeof smtpConfigTable.$inferSelect;

/**
 * Single-row authentication / session configuration. Lets an admin tune how
 * long a login stays valid without redeploying. The values feed better-auth's
 * `session.expiresIn` (lifetime) and `session.updateAge` (sliding-refresh
 * interval); see `src/server/auth/session-config.ts` for how they are loaded
 * and applied live. `id` is constrained to literal `1`.
 */
export const authSettingsTable = pgTable("auth_settings", {
  id: integer("id").primaryKey().notNull().default(1),
  /** Session lifetime in days. */
  sessionExpiresInDays: integer("session_expires_in_days").notNull().default(90),
  /** Sliding-window refresh interval in hours. */
  sessionUpdateAgeHours: integer("session_update_age_hours").notNull().default(24),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export type AuthSettings = typeof authSettingsTable.$inferSelect;
