import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * App-wide mail log. One row per outbound mail Kontor2 tries to send -- antrag
 * confirmations, the club notification, approvals/declines, Mahnungen, user
 * invites, portal invites, and SMTP test mails. Records whether the send
 * succeeded, was skipped (no SMTP configured, no recipient), or failed, so the
 * Vorstand can see what actually went out from one place (the Versandprotokoll)
 * instead of guessing.
 *
 * This is deliberately separate from `app_log` (the Systemprotokoll): that is a
 * volatile, retention-capped technical log, while the mail log is a small,
 * durable record of member-facing correspondence. `entityType` + `entityId`
 * link a row to whatever it concerns (a membership application, a member, …),
 * so a detail page can show just that entity's mail history.
 */
export const emailStatusEnum = pgEnum("email_status", ["sent", "failed", "skipped"]);

export const emailLogTable = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Mail type, e.g. "antrag_confirmation", "dunning", "invite". See EMAIL_KIND. */
    kind: text("kind").notNull(),
    status: emailStatusEnum("status").notNull(),
    recipient: text("recipient"),
    subject: text("subject"),
    /** Reason on a skipped/failed send, e.g. "smtp_not_configured" or an SMTP error. */
    detail: text("detail"),
    /** What the mail concerns, e.g. "membership_application" | "member" | "user". */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** Acting user who triggered the send, when there was one. */
    actorEmail: text("actor_email"),
    /** Correlates with app_log rows from the same request. */
    requestId: text("request_id"),
  },
  (t) => [
    index("email_log_created_idx").on(t.createdAt),
    index("email_log_kind_created_idx").on(t.kind, t.createdAt),
    index("email_log_status_created_idx").on(t.status, t.createdAt),
    index("email_log_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);

export type EmailLogRow = typeof emailLogTable.$inferSelect;
export type NewEmailLogRow = typeof emailLogTable.$inferInsert;
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
