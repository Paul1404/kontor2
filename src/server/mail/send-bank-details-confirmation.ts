import { getMailer } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";

export type BankDetailsConfirmationContent = {
  to: string;
  subject: string;
  body: string;
};

export type BankDetailsConfirmationParams = {
  to: string;
  memberName: string;
  organizationName: string;
  newIbanLast4: string;
  debitSuspended: boolean;
};

/**
 * Build the exact text used by both the preview and the actual dispatch.
 * Only the final four IBAN characters are accepted so account data cannot
 * accidentally leak into a member-facing email or its delivery log.
 */
export function buildBankDetailsConfirmation(
  params: BankDetailsConfirmationParams,
): BankDetailsConfirmationContent {
  const debitText = params.debitSuspended
    ? "Der SEPA-Einzug ist vorerst ausgesetzt. Bitte setzen Sie sich mit uns in Verbindung, bevor der nächste Beitrag eingezogen werden soll."
    : "Künftige Beitragseinzüge verwenden die neue Bankverbindung.";

  return {
    to: params.to,
    subject: `${params.organizationName}: Bankverbindung geändert`,
    body: [
      `Guten Tag ${params.memberName},`,
      "",
      "wir bestätigen, dass wir Ihre bei uns hinterlegte Bankverbindung geändert haben.",
      `Die neue IBAN endet auf •••• ${params.newIbanLast4}.`,
      debitText,
      "",
      "Falls Sie diese Änderung nicht veranlasst haben, melden Sie sich bitte umgehend bei uns.",
      "",
      "Mit freundlichen Grüßen",
      params.organizationName,
    ].join("\n"),
  };
}

export async function sendBankDetailsConfirmation(
  db: DB,
  content: BankDetailsConfirmationContent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const mailer = await getMailer(db);
    if (!mailer) return { ok: false, reason: "smtp_not_configured" };
    await mailer.send({ to: content.to, subject: content.subject, text: content.body });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
