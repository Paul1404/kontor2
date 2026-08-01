import { getMailer } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";

export type BankDetailsConfirmationContent = {
  to: string;
  subject: string;
  body: string;
  html: string;
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

  const body = [
    "Kontor² · Automatische Bestätigung",
    "",
    `Guten Tag ${params.memberName},`,
    "",
    "wir bestätigen, dass wir Ihre bei uns hinterlegte Bankverbindung geändert haben.",
    `Die neue IBAN endet auf •••• ${params.newIbanLast4}.`,
    debitText,
    "",
    "Falls Sie diese Änderung nicht veranlasst haben, melden Sie sich bitte umgehend bei uns.",
    "",
    "Freundliche Grüße",
    params.organizationName,
    "",
    `Diese Nachricht wurde automatisch mit Kontor² im Auftrag von ${params.organizationName} erstellt.`,
  ].join("\n");

  return {
    to: params.to,
    subject: `${params.organizationName}: Bankverbindung geändert`,
    body,
    html: buildBrandedHtml(params, debitText),
  };
}

function buildBrandedHtml(params: BankDetailsConfirmationParams, debitText: string): string {
  const memberName = escapeHtml(params.memberName);
  const organizationName = escapeHtml(params.organizationName);
  const last4 = escapeHtml(params.newIbanLast4);
  const debit = escapeHtml(debitText);
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f6f3ec;color:#14223d;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ihre Bankverbindung wurde aktualisiert.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ec;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #ddd4c0;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#14223d;color:#f6f3ec;padding:24px 28px;">
          <div style="font-family:Georgia,serif;font-size:26px;font-weight:600;letter-spacing:-0.3px;">Kontor<sup style="color:#c5a66b;font-size:14px;">2</sup></div>
          <div style="margin-top:5px;color:#c9d0dc;font-size:13px;">Automatische Bestätigung</div>
        </td></tr>
        <tr><td style="padding:30px 28px;font-size:16px;line-height:1.6;">
          <p style="margin:0 0 18px;">Guten Tag ${memberName},</p>
          <p style="margin:0 0 18px;">wir bestätigen, dass wir Ihre bei uns hinterlegte Bankverbindung geändert haben.</p>
          <div style="margin:22px 0;padding:16px 18px;background:#f6f3ec;border-left:4px solid #a6864e;border-radius:6px;">
            <div style="color:#5b6472;font-size:12px;text-transform:uppercase;letter-spacing:0.7px;">Neue Bankverbindung</div>
            <div style="margin-top:4px;font-family:monospace;font-size:18px;font-weight:600;">IBAN endet auf •••• ${last4}</div>
          </div>
          <p style="margin:0 0 18px;">${debit}</p>
          <p style="margin:0 0 24px;">Falls Sie diese Änderung nicht veranlasst haben, melden Sie sich bitte umgehend bei uns.</p>
          <p style="margin:0;">Freundliche Grüße<br><strong>${organizationName}</strong></p>
        </td></tr>
        <tr><td style="border-top:1px solid #ddd4c0;background:#f6f3ec;padding:18px 28px;color:#5b6472;font-size:12px;line-height:1.5;">
          Diese Nachricht wurde automatisch mit <strong style="color:#14223d;">Kontor²</strong> im Auftrag von ${organizationName} erstellt.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
