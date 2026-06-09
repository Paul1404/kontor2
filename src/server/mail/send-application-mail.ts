/**
 * Mail dispatch for the membership application flow. The shared `getMailer`
 * helper only sends plain text; an application confirmation carries the
 * generated Beitrittserklärung PDF, so we build a nodemailer transporter with
 * an attachment here. Degrades gracefully when SMTP is unconfigured: callers
 * treat a falsy result as "not sent" and leave `email_sent = false`.
 */

import nodemailer from "nodemailer";
import { loadSmtpConfig } from "~/server/auth/send-invite";
import { logger } from "~/server/lib/logger";
import type { ApplicationEmailRecord } from "~/server/mail/application-email-log";

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

type SendResult = { ok: true } | { ok: false; reason: string };

async function sendRaw(opts: {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}): Promise<SendResult> {
  const cfg = await loadSmtpConfig();
  if (!cfg) return { ok: false, reason: "smtp_not_configured" };
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.requireTls,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
    tls: {
      servername: cfg.host,
      rejectUnauthorized: !cfg.allowInvalidCerts,
      minVersion: "TLSv1.2",
    },
  });
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      attachments: opts.attachments,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Send a single application document mail (e.g. the approval with the
 * countersigned Beitrittserklärung attached) and map the outcome onto the
 * email-log vocabulary. Never throws.
 */
export async function sendApplicationDocumentMail(opts: {
  to: string;
  subject: string;
  text: string;
  pdf?: MailAttachment | null;
}): Promise<{ status: "sent" | "failed" | "skipped"; detail: string | null }> {
  const res = await sendRaw({
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    attachments: opts.pdf ? [opts.pdf] : undefined,
  });
  if (res.ok) return { status: "sent", detail: null };
  return {
    status: res.reason === "smtp_not_configured" ? "skipped" : "failed",
    detail: res.reason,
  };
}

/**
 * Confirmation to the applicant plus a notification to the club. Best-effort:
 * a failure on either is logged and reported via the return value, never
 * thrown, so a submission is never lost to an SMTP hiccup.
 */
export async function sendApplicationMails(opts: {
  vereinsname: string;
  applicantEmail: string | null;
  applicantName: string;
  clubEmail: string | null;
  notifyClub: boolean;
  antragsnummer: string;
  statusUrl: string;
  uploadUrl?: string | null;
  pdf: MailAttachment;
}): Promise<{ applicantSent: boolean; clubSent: boolean; records: ApplicationEmailRecord[] }> {
  let applicantSent = false;
  let clubSent = false;
  const records: ApplicationEmailRecord[] = [];

  const applicantSubject = `Ihre Beitrittserklärung – ${opts.vereinsname}`;
  if (opts.applicantEmail) {
    const lines = [
      `Hallo ${opts.applicantName},`,
      "",
      `vielen Dank für Ihren Aufnahmeantrag beim ${opts.vereinsname}.`,
      `Ihre Antragsnummer lautet ${opts.antragsnummer}.`,
      "",
      `Den aktuellen Stand sehen Sie hier: ${opts.statusUrl}`,
      ...(opts.uploadUrl
        ? [
            "",
            "Bitte drucken Sie die angehängte Beitrittserklärung aus, unterschreiben Sie sie",
            `und laden Sie den Scan hier wieder hoch (30 Tage gültig): ${opts.uploadUrl}`,
          ]
        : []),
      "",
      "Die ausgefüllte Beitrittserklärung finden Sie im Anhang.",
    ];
    const res = await sendRaw({
      to: opts.applicantEmail,
      subject: applicantSubject,
      text: lines.join("\n"),
      attachments: [opts.pdf],
    });
    applicantSent = res.ok;
    if (!res.ok && res.reason !== "smtp_not_configured") {
      logger.warn("application.mail.applicant_failed", { reason: res.reason });
    }
    records.push({
      kind: "confirmation",
      status: res.ok ? "sent" : res.reason === "smtp_not_configured" ? "skipped" : "failed",
      recipient: opts.applicantEmail,
      subject: applicantSubject,
      detail: res.ok ? null : res.reason,
    });
  } else {
    records.push({
      kind: "confirmation",
      status: "skipped",
      subject: applicantSubject,
      detail: "no_recipient",
    });
  }

  if (opts.notifyClub) {
    const clubSubject = `Neuer Aufnahmeantrag: ${opts.applicantName} (${opts.antragsnummer})`;
    if (opts.clubEmail) {
      const res = await sendRaw({
        to: opts.clubEmail,
        subject: clubSubject,
        text: [
          "Ein neuer Online-Aufnahmeantrag ist eingegangen.",
          "",
          `Antragsteller: ${opts.applicantName}`,
          `Antragsnummer: ${opts.antragsnummer}`,
          "",
          "Die Beitrittserklärung ist angehängt. Bearbeitung im Bereich Anträge.",
        ].join("\n"),
        attachments: [opts.pdf],
      });
      clubSent = res.ok;
      if (!res.ok && res.reason !== "smtp_not_configured") {
        logger.warn("application.mail.club_failed", { reason: res.reason });
      }
      records.push({
        kind: "club_notification",
        status: res.ok ? "sent" : res.reason === "smtp_not_configured" ? "skipped" : "failed",
        recipient: opts.clubEmail,
        subject: clubSubject,
        detail: res.ok ? null : res.reason,
      });
    } else {
      records.push({
        kind: "club_notification",
        status: "skipped",
        subject: clubSubject,
        detail: "no_recipient",
      });
    }
  }

  return { applicantSent, clubSent, records };
}
