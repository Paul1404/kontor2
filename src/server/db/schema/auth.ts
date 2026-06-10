import { bigint, boolean, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("user_role", ["admin", "vorstand", "readonly"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: roleEnum("role").notNull().default("readonly"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-issued invites. The raw token is mailed to the user and brought back to
 * /invite/:token to set a password. Only the SHA-256 hash is stored, never the
 * raw token, so a database/backup leak cannot be replayed to self-provision an
 * account (mirrors the portal magic-link design).
 */
export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  /** Deprecated: legacy plaintext token column. New invites leave this null. */
  token: text("token"),
  /** SHA-256 of the raw token; the value actually looked up. */
  tokenHash: text("token_hash").unique(),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * API keys for the MCP endpoint (/api/mcp), managed by the better-auth
 * `@better-auth/api-key` plugin (model `apikey`; with `usePlural: true` the
 * adapter schema key must be `apikeys`). `key` holds only the SHA-256 hash of
 * the issued key; the plaintext is shown exactly once at creation. The owner
 * lives in `referenceId` (a users.id): a key acts with that user's role, so
 * revoking the user (cascade) or disabling the key cuts off access.
 * Duration fields are milliseconds; `bigint` because int4 overflows past ~24
 * days of ms.
 */
export const apikeys = pgTable("apikeys", {
  id: text("id").primaryKey(),
  configId: text("config_id").notNull().default("default"),
  name: text("name"),
  start: text("start"),
  prefix: text("prefix"),
  key: text("key").notNull(),
  referenceId: text("reference_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refillInterval: bigint("refill_interval", { mode: "number" }),
  refillAmount: integer("refill_amount"),
  lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: bigint("rate_limit_time_window", { mode: "number" }),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: timestamp("last_request", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

export type Role = (typeof roleEnum.enumValues)[number];
