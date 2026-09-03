/**
 * Mail dispatch for the membership application flow. Both mails carry the
 * generated Beitrittserklärung PDF and are rendered in the shared club design.
 * Degrades gracefully when SMTP is unconfigured: callers treat a falsy result
 * as "not sent" and leave `email_sent = false`.
 */

import { sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { logger } from "~/server/lib/logger";
import { EMAIL_KIND, type EmailLogEntry } from "~/server/mail/email-log";
import type { MailBlock } from "~/server/mail/layout";

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

/**
 * Send a single application document mail (e.g. the approval with the
 * countersigned Beitrittserklärung attached) and map the outcome onto the
 * email-log vocabulary. Never throws.
 */
export async function sendApplicationDocumentMail(
  db: DB,
  opts: {
    to: string;
    subject: string;
    text: string;
    pdf?: MailAttachment | null;
    /** Line under the club name; defaults to the neutral membership wording. */
    subline?: string;
    greeting?: string | null;
    /** Pass null for a club-internal notice, which must not sign off to itself. */
    closing?: string | null;
    /** Inbox preview line. Defaults to the subject when there is nothing better. */
    preheader?: string;
  },
): Promise<{ status: "sent" | "failed" | "skipped"; detail: string | null; bodyHtml?: string }> {
  const res = await sendBrandedMail(db, {
    to: opts.to,
    subject: opts.subject,
    attachments: opts.pdf ? [opts.pdf] : undefined,
    document: {
      preheader: opts.preheader ?? opts.subject,
      subline: opts.subline ?? "Mitgliedschaft",
      greeting: opts.greeting ?? null,
      closing: opts.closing,
      blocks: paragraphBlocks(opts.text),
    },
  });
  if (res.ok) return { status: "sent", detail: null, bodyHtml: res.bodyHtml };
  return {
    status: res.reason === "smtp_not_configured" ? "skipped" : "failed",
    detail: res.reason,
    bodyHtml: res.bodyHtml,
  };
}

function paragraphBlocks(text: string): MailBlock[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((value) => ({ kind: "paragraph", text: value }) as MailBlock);
}

/**
 * Confirmation to the applicant plus a notification to the club. Best-effort:
 * a failure on either is logged and reported via the return value, never
 * thrown, so a submission is never lost to an SMTP hiccup.
 */
export async function sendApplicationMails(
  db: DB,
  opts: {
    vereinsname: string;
    applicantEmail: string | null;
    applicantName: string;
    clubEmail: string | null;
    notifyClub: boolean;
    antragsnummer: string;
    statusUrl: string;
    uploadUrl?: string | null;
    pdf: MailAttachment;
  },
): Promise<{ applicantSent: boolean; clubSent: boolean; records: EmailLogEntry[] }> {
  let applicantSent = false;
  let clubSent = false;
  const records: EmailLogEntry[] = [];

  const applicantSubject = `${opts.vereinsname}: Ihre Beitrittserklärung`;
  if (opts.applicantEmail) {
    const res = await sendBrandedMail(db, {
      to: opts.applicantEmail,
      subject: applicantSubject,
      attachments: [opts.pdf],
      document: {
        preheader: `Ihr Aufnahmeantrag ${opts.antragsnummer} ist eingegangen.`,
        subline: "Aufnahmeantrag",
        greeting: `Hallo ${opts.applicantName},`,
        blocks: [
          {
            kind: "paragraph",
            text: "vielen Dank für Ihren Aufnahmeantrag. Er ist bei uns eingegangen.",
          },
          { kind: "callout", label: "Antragsnummer", value: opts.antragsnummer },
          { kind: "button", label: "Aktuellen Stand ansehen", url: opts.statusUrl },
          ...(opts.uploadUrl
            ? ([
                {
                  kind: "paragraph",
                  text: "Bitte drucken Sie die angehängte Beitrittserklärung aus, unterschreiben Sie sie und laden Sie den Scan wieder hoch.",
                },
                { kind: "button", label: "Unterschrift hochladen", url: opts.uploadUrl },
                { kind: "note", text: "Der Upload-Link ist 30 Tage gültig." },
              ] as MailBlock[])
            : []),
          {
            kind: "note",
            text: "Die ausgefüllte Beitrittserklärung finden Sie im Anhang.",
          },
        ],
      },
    });
    applicantSent = res.ok;
    if (!res.ok && res.reason !== "smtp_not_configured") {
      logger.warn("application.mail.applicant_failed", { reason: res.reason });
    }
    records.push({
      kind: EMAIL_KIND.antragConfirmation,
      status: res.ok ? "sent" : res.reason === "smtp_not_configured" ? "skipped" : "failed",
      recipient: opts.applicantEmail,
      subject: applicantSubject,
      bodyText: res.bodyText,
      bodyHtml: res.bodyHtml,
      messageId: res.messageId,
      attachmentNames: [opts.pdf.filename],
      detail: res.ok ? null : res.reason,
    });
  } else {
    records.push({
      kind: EMAIL_KIND.antragConfirmation,
      status: "skipped",
      subject: applicantSubject,
      detail: "no_recipient",
    });
  }

  if (opts.notifyClub) {
    const clubSubject = `Neuer Aufnahmeantrag: ${opts.applicantName} (${opts.antragsnummer})`;
    if (opts.clubEmail) {
      const res = await sendBrandedMail(db, {
        to: opts.clubEmail,
        subject: clubSubject,
        attachments: [opts.pdf],
        document: {
          preheader: `Neuer Aufnahmeantrag von ${opts.applicantName}.`,
          subline: "Interne Benachrichtigung",
          greeting: null,
          closing: null,
          blocks: [
            { kind: "paragraph", text: "Ein neuer Online-Aufnahmeantrag ist eingegangen." },
            {
              kind: "bullets",
              items: [
                `Antragsteller: ${opts.applicantName}`,
                `Antragsnummer: ${opts.antragsnummer}`,
              ],
            },
            {
              kind: "note",
              text: "Die Beitrittserklärung ist angehängt. Bearbeitung im Bereich Anträge.",
            },
          ],
        },
      });
      clubSent = res.ok;
      if (!res.ok && res.reason !== "smtp_not_configured") {
        logger.warn("application.mail.club_failed", { reason: res.reason });
      }
      records.push({
        kind: EMAIL_KIND.antragClubNotification,
        status: res.ok ? "sent" : res.reason === "smtp_not_configured" ? "skipped" : "failed",
        recipient: opts.clubEmail,
        subject: clubSubject,
        bodyText: res.bodyText,
        bodyHtml: res.bodyHtml,
        messageId: res.messageId,
        attachmentNames: [opts.pdf.filename],
        detail: res.ok ? null : res.reason,
      });
    } else {
      records.push({
        kind: EMAIL_KIND.antragClubNotification,
        status: "skipped",
        subject: clubSubject,
        detail: "no_recipient",
      });
    }
  }

  return { applicantSent, clubSent, records };
}
