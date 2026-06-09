/**
 * Persistence for the membership-application email log. Every mail the antrag
 * flow attempts (applicant confirmation, club notification, approval, decline)
 * leaves a row here so the Vorstand can see on the detail page whether it went
 * out, was skipped (no SMTP / no recipient), or failed -- without combing the
 * Systemprotokoll. Writing the log is best-effort and never throws into the
 * caller: a failed log write must not undo an approval or lose a submission.
 */

import type { DBOrTx } from "~/server/db/client";
import {
  type AntragEmailKind,
  type AntragEmailStatus,
  membershipApplicationEmailsTable,
} from "~/server/db/schema/membership-applications";
import { logger } from "~/server/lib/logger";

export type ApplicationEmailRecord = {
  kind: AntragEmailKind;
  status: AntragEmailStatus;
  recipient?: string | null;
  subject?: string | null;
  /** Reason on a skipped/failed send, e.g. "smtp_not_configured" or "no_recipient". */
  detail?: string | null;
};

export async function recordApplicationEmails(
  db: DBOrTx,
  applicationId: string,
  records: ApplicationEmailRecord[],
): Promise<void> {
  if (records.length === 0) return;
  try {
    await db.insert(membershipApplicationEmailsTable).values(
      records.map((r) => ({
        applicationId,
        kind: r.kind,
        status: r.status,
        recipient: r.recipient ?? null,
        subject: r.subject ?? null,
        detail: r.detail ?? null,
      })),
    );
  } catch (err) {
    logger.warn("application.email_log.write_failed", {
      applicationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
