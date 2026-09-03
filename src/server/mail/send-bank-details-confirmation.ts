import { getMailer } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import {
  loadMailOrganization,
  type MailInlineAttachment,
  type MailOrganization,
} from "~/server/mail/branding";
import { type MailBlock, renderMail } from "~/server/mail/layout";

export type BankDetailsConfirmationContent = {
  to: string;
  subject: string;
  body: string;
  html: string;
  attachments: MailInlineAttachment[];
};

export type BankDetailsConfirmationParams = {
  to: string;
  memberName: string;
  organization: MailOrganization;
  newIbanLast4: string;
  debitSuspended: boolean;
};

/** @deprecated Use `MailOrganization` from `~/server/mail/branding`. */
export type BankDetailsConfirmationOrganization = MailOrganization;

export async function loadBankDetailsConfirmationOrganization(db: DB): Promise<MailOrganization> {
  return loadMailOrganization(db);
}

/**
 * Build the exact content used by both the preview and the actual dispatch.
 * Only the final four IBAN characters are accepted so account data cannot
 * accidentally leak into a member-facing email or its delivery log.
 */
/**
 * The message itself, independent of channel. Email and letter are both built
 * from this, so a member reached by post is told exactly what one reached by
 * email is told.
 */
export function bankDetailsConfirmationContent(params: BankDetailsConfirmationParams): {
  greeting: string;
  blocks: MailBlock[];
} {
  const debitText = params.debitSuspended
    ? "Der SEPA-Einzug ist vorerst ausgesetzt. Bitte setzen Sie sich mit uns in Verbindung, bevor der nächste Beitrag eingezogen werden soll."
    : "Künftige Beitragseinzüge verwenden die neue Bankverbindung.";
  return {
    greeting: `Guten Tag ${params.memberName},`,
    blocks: [
      {
        kind: "paragraph",
        text: "wir bestätigen, dass wir Ihre bei uns hinterlegte Bankverbindung geändert haben.",
      },
      {
        kind: "callout",
        label: "Neue Bankverbindung",
        value: `IBAN endet auf •••• ${params.newIbanLast4}`,
      },
      { kind: "paragraph", text: debitText },
      {
        kind: "paragraph",
        text: "Falls Sie diese Änderung nicht veranlasst haben, melden Sie sich bitte umgehend bei uns.",
      },
    ],
  };
}

export function buildBankDetailsConfirmation(
  params: BankDetailsConfirmationParams,
): BankDetailsConfirmationContent {
  const { organization } = params;
  const content = bankDetailsConfirmationContent(params);
  const rendered = renderMail({
    organization,
    preheader: "Ihre Bankverbindung wurde aktualisiert.",
    subline: "Bankverbindung",
    greeting: content.greeting,
    blocks: content.blocks,
  });

  return {
    to: params.to,
    subject: `${organization.displayName}: Bankverbindung geändert`,
    body: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments,
  };
}

export async function sendBankDetailsConfirmation(
  db: DB,
  content: BankDetailsConfirmationContent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const mailer = await getMailer(db);
    if (!mailer) return { ok: false, reason: "smtp_not_configured" };
    await mailer.send({
      to: content.to,
      subject: content.subject,
      text: content.body,
      html: content.html,
      attachments: content.attachments,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
