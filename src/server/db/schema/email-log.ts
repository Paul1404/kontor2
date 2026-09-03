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
/**
 * `sent` means the mail server accepted the message, not that it arrived. A
 * later bounce report moves the row to `bounced`, which is the only status that
 * proves the member did not get it.
 */
export const emailStatusEnum = pgEnum("email_status", [
  "sent",
  "failed",
  "skipped",
  "bounced",
  /** A postal notification was generated. Posting it stays a human act. */
  "printed",
]);

/**
 * How the member was notified. A club has members without an email address, so
 * post is not a fallback but the second regular channel; the log has to answer
 * "was this member informed" for both.
 */
export const notificationChannelEnum = pgEnum("notification_channel", ["email", "post"]);

export const emailLogTable = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Mail type, e.g. "antrag_confirmation", "dunning", "invite". See EMAIL_KIND. */
    kind: text("kind").notNull(),
    status: emailStatusEnum("status").notNull(),
    channel: notificationChannelEnum("channel").notNull().default("email"),
    recipient: text("recipient"),
    subject: text("subject"),
    /** Exact plain-text body handed to the mail transport. Stored for read-only audit. */
    bodyText: text("body_text"),
    /** Exact HTML body handed to the mail transport, when the message had one. */
    bodyHtml: text("body_html"),
    /** Attachment filenames only. Binary attachment data remains in its domain storage. */
    attachmentNames: text("attachment_names").array(),
    /** Reason on a skipped/failed send, e.g. "smtp_not_configured" or an SMTP error. */
    detail: text("detail"),
    /**
     * RFC 5322 Message-ID handed back by the transport. A bounce report quotes
     * it, so it is what lets an asynchronous delivery failure find its way back
     * to the row it belongs to.
     */
    messageId: text("message_id"),
    /** When a delivery failure report for this message was recorded. */
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    /** RFC 3463 status like "5.2.2", plus the server's diagnostic text. */
    bounceCode: text("bounce_code"),
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
    index("email_log_channel_created_idx").on(t.channel, t.createdAt),
    index("email_log_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("email_log_message_id_idx").on(t.messageId),
    index("email_log_recipient_created_idx").on(t.recipient, t.createdAt),
  ],
);

export type EmailLogRow = typeof emailLogTable.$inferSelect;
export type NewEmailLogRow = typeof emailLogTable.$inferInsert;
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];

export type NotificationChannel = (typeof notificationChannelEnum.enumValues)[number];
