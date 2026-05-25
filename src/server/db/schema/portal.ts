import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "~/server/db/schema/auth";
import { membersTable } from "~/server/db/schema/members";

export const portalChangeStatusEnum = pgEnum("portal_change_status", [
  "pending",
  "applied",
  "rejected",
  "partial",
]);

/**
 * One-shot magic-link tokens that grant a single member access to a
 * self-service portal. The token is generated, sent by mail, and consumed
 * once. Subsequent requests use the cookie session it spawns (kept in
 * `portal_sessions`).
 *
 * `tokenHash` is the SHA-256 of the raw token; the raw token never lives
 * in the database after creation. Validation hashes the URL parameter and
 * compares.
 */
export const portalTokensTable = pgTable(
  "portal_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    sentToEmail: text("sent_to_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("portal_tokens_hash_uk").on(t.tokenHash),
    index("portal_tokens_member_idx").on(t.memberId),
  ],
);

/**
 * Server-side portal sessions. A row is created when a token is consumed
 * and the member arrives at the portal. The session cookie carries
 * `sessionId` and `secret`; we compare the secret with the stored
 * `secretHash` to authenticate. Sessions are bound to a single member and
 * have a fixed TTL set at creation.
 */
export const portalSessionsTable = pgTable(
  "portal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    secretHash: text("secret_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdFromTokenId: uuid("created_from_token_id").references(() => portalTokensTable.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("portal_sessions_member_idx").on(t.memberId)],
);

/**
 * Pending Stammdaten-Änderung submitted via the portal. Admin / Vorstand
 * review the row and either apply (writes through `appliedFields` keys) or
 * reject the whole request. The change payload is a flat field map of
 * `{ key: { before, after } }` matching the audit-log diff format.
 */
export const portalChangeRequestsTable = pgTable(
  "portal_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => membersTable.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => portalSessionsTable.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    submittedIp: text("submitted_ip"),
    payload: jsonb("payload")
      .$type<Record<string, { before: unknown; after: unknown }>>()
      .notNull(),
    status: portalChangeStatusEnum("status").notNull().default("pending"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewerNotes: text("reviewer_notes"),
    appliedFields: jsonb("applied_fields").$type<string[]>(),
  },
  (t) => [
    index("portal_change_requests_member_idx").on(t.memberId, t.submittedAt),
    index("portal_change_requests_status_idx").on(t.status, t.submittedAt),
  ],
);

export type PortalToken = typeof portalTokensTable.$inferSelect;
export type PortalSession = typeof portalSessionsTable.$inferSelect;
export type PortalChangeRequest = typeof portalChangeRequestsTable.$inferSelect;
export type PortalChangeStatus = (typeof portalChangeStatusEnum.enumValues)[number];
