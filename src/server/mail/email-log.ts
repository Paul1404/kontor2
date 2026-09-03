/**
 * App-wide mail log helper. Every place that sends a mail records the outcome
 * here so the Versandprotokoll (and per-entity views like the antrag detail
 * page) can show what went out. Writing the log is best-effort and never
 * throws into the caller: a failed log write must not undo the action that
 * sent the mail, nor lose the mail itself.
 */

import type { DBOrTx } from "~/server/db/client";
import { type EmailStatus, emailLogTable } from "~/server/db/schema/email-log";
import { logger } from "~/server/lib/logger";

/** Canonical mail kinds. Free-form text in the column; use these constants. */
export const EMAIL_KIND = {
  antragConfirmation: "antrag_confirmation",
  antragClubNotification: "antrag_club_notification",
  antragApproval: "antrag_approval",
  antragDecline: "antrag_decline",
  bankDetailsConfirmation: "bank_details_confirmation",
  cancellationConfirmation: "cancellation_confirmation",
  dunning: "dunning",
  invite: "invite",
  portalInvite: "portal_invite",
  passwordReset: "password_reset",
  testMail: "test_mail",
} as const;

export type EmailLogEntry = {
  kind: string;
  status: EmailStatus;
  recipient?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  attachmentNames?: string[] | null;
  detail?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorEmail?: string | null;
  requestId?: string | null;
};

/**
 * Map a sender's `{ ok } | { ok: false; reason }` result onto the log
 * vocabulary: a missing SMTP config is "skipped" (nothing was wrong, there is
 * just nowhere to send), any other failure is "failed".
 */
export function statusFromSend(res: { ok: true } | { ok: false; reason: string }): {
  status: EmailStatus;
  detail: string | null;
} {
  if (res.ok) return { status: "sent", detail: null };
  return {
    status: res.reason === "smtp_not_configured" ? "skipped" : "failed",
    detail: res.reason,
  };
}

export async function recordEmail(
  entries: EmailLogEntry | EmailLogEntry[],
  handle: DBOrTx,
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  try {
    await handle.insert(emailLogTable).values(
      list.map((e) => ({
        kind: e.kind,
        status: e.status,
        recipient: e.recipient ?? null,
        subject: e.subject ?? null,
        bodyText: e.bodyText ?? null,
        bodyHtml: e.bodyHtml ?? null,
        attachmentNames: e.attachmentNames ?? null,
        detail: e.detail ?? null,
        entityType: e.entityType ?? null,
        entityId: e.entityId ?? null,
        actorEmail: e.actorEmail ?? null,
        requestId: e.requestId ?? null,
      })),
    );
  } catch (err) {
    logger.warn("email_log.write_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
