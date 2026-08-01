import { normalizeHex } from "~/lib/branding-color";
import { getMailer } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";

export type BankDetailsConfirmationContent = {
  to: string;
  subject: string;
  body: string;
  html: string;
  attachments: Array<BankDetailsConfirmationAttachment>;
};

type BankDetailsConfirmationAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
  contentDisposition: "inline";
};

export type BankDetailsConfirmationParams = {
  to: string;
  memberName: string;
  organization: BankDetailsConfirmationOrganization;
  newIbanLast4: string;
  debitSuspended: boolean;
};

export type BankDetailsConfirmationOrganization = {
  displayName: string;
  legalName: string;
  addressLines: string[];
  contactEmail: string | null;
  contactPhone: string | null;
  brandColor: string;
  logoDataUri: string | null;
};

export async function loadBankDetailsConfirmationOrganization(
  db: DB,
): Promise<BankDetailsConfirmationOrganization> {
  try {
    const [organization] = await db
      .select({
        displayName: organizationSettingsTable.anzeigename,
        legalName: organizationSettingsTable.vereinsname,
        street: organizationSettingsTable.anschriftStrasse,
        postalCode: organizationSettingsTable.anschriftPlz,
        city: organizationSettingsTable.anschriftOrt,
        membershipEmail: organizationSettingsTable.mitgliedschaftEmail,
        contactEmail: organizationSettingsTable.kontaktEmail,
        contactPhone: organizationSettingsTable.kontaktTelefon,
        primaryColor: organizationSettingsTable.primaryColor,
        logo: organizationSettingsTable.logo,
      })
      .from(organizationSettingsTable)
      .limit(1);
    const legalName = organization?.legalName?.trim() || "Vereinsverwaltung";
    const locality = [organization?.postalCode?.trim(), organization?.city?.trim()]
      .filter(Boolean)
      .join(" ");
    return {
      displayName: organization?.displayName?.trim() || legalName,
      legalName,
      addressLines: [organization?.street?.trim(), locality].filter((line): line is string =>
        Boolean(line),
      ),
      contactEmail:
        organization?.membershipEmail?.trim() || organization?.contactEmail?.trim() || null,
      contactPhone: organization?.contactPhone?.trim() || null,
      brandColor: normalizeHex(organization?.primaryColor) || "#a6864e",
      logoDataUri: validLogoDataUri(organization?.logo),
    };
  } catch {
    return {
      displayName: "Vereinsverwaltung",
      legalName: "Vereinsverwaltung",
      addressLines: [],
      contactEmail: null,
      contactPhone: null,
      brandColor: "#a6864e",
      logoDataUri: null,
    };
  }
}

/**
 * Build the exact text used by both the preview and the actual dispatch.
 * Only the final four IBAN characters are accepted so account data cannot
 * accidentally leak into a member-facing email or its delivery log.
 */
export function buildBankDetailsConfirmation(
  params: BankDetailsConfirmationParams,
): BankDetailsConfirmationContent {
  const { organization } = params;
  const debitText = params.debitSuspended
    ? "Der SEPA-Einzug ist vorerst ausgesetzt. Bitte setzen Sie sich mit uns in Verbindung, bevor der nächste Beitrag eingezogen werden soll."
    : "Künftige Beitragseinzüge verwenden die neue Bankverbindung.";

  const body = [
    organization.displayName,
    "Automatische Bestätigung Ihrer Vereinsverwaltung",
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
    organization.displayName,
    "",
    ...(organization.legalName !== organization.displayName ? [organization.legalName] : []),
    ...organization.addressLines,
    ...(organization.contactEmail ? [`E-Mail: ${organization.contactEmail}`] : []),
    ...(organization.contactPhone ? [`Telefon: ${organization.contactPhone}`] : []),
    "",
    "Diese Nachricht wurde automatisch erstellt.",
    "Technisch versendet über Kontor².",
  ].join("\n");

  return {
    to: params.to,
    subject: `${organization.displayName}: Bankverbindung geändert`,
    body,
    html: buildBrandedHtml(params, debitText),
    attachments: organization.logoDataUri ? [buildLogoAttachment(organization.logoDataUri)] : [],
  };
}

function buildBrandedHtml(params: BankDetailsConfirmationParams, debitText: string): string {
  const { organization } = params;
  const memberName = escapeHtml(params.memberName);
  const displayName = escapeHtml(organization.displayName);
  const legalName = escapeHtml(organization.legalName);
  const address = organization.addressLines.map(escapeHtml);
  const contactEmail = organization.contactEmail ? escapeHtml(organization.contactEmail) : null;
  const contactPhone = organization.contactPhone ? escapeHtml(organization.contactPhone) : null;
  const brandColor = escapeHtml(organization.brandColor);
  const last4 = escapeHtml(params.newIbanLast4);
  const debit = escapeHtml(debitText);
  const identityLines = [
    organization.legalName !== organization.displayName ? legalName : null,
    ...address,
    contactEmail ? `E-Mail: ${contactEmail}` : null,
    contactPhone ? `Telefon: ${contactPhone}` : null,
  ].filter(Boolean);
  const header = organization.logoDataUri
    ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="padding-right:16px;vertical-align:middle;"><img src="cid:vereinslogo@kontor2" width="64" alt="" style="display:block;width:auto;max-width:64px;height:auto;max-height:64px;border:0;"></td>
          <td style="vertical-align:middle;">
            <div style="color:#14223d;font-family:Georgia,serif;font-size:25px;font-weight:600;letter-spacing:-0.3px;">${displayName}</div>
            <div style="margin-top:6px;color:#5b6472;font-size:13px;">Automatische Bestätigung Ihrer Vereinsverwaltung</div>
          </td>
        </tr></table>`
    : `<div style="color:#14223d;font-family:Georgia,serif;font-size:25px;font-weight:600;letter-spacing:-0.3px;">${displayName}</div>
          <div style="margin-top:6px;color:#5b6472;font-size:13px;">Automatische Bestätigung Ihrer Vereinsverwaltung</div>`;
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f6f3ec;color:#14223d;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ihre Bankverbindung wurde aktualisiert.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f6f3ec;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #ddd4c0;border-radius:12px;overflow:hidden;">
        <tr><td style="height:6px;background:${brandColor};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="background:#ffffff;padding:24px 28px 20px;border-bottom:1px solid #ddd4c0;">
          ${header}
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
          <p style="margin:0;">Freundliche Grüße<br><strong>${displayName}</strong></p>
        </td></tr>
        <tr><td style="border-top:1px solid #ddd4c0;background:#f6f3ec;padding:20px 28px;color:#3f4857;font-size:12px;line-height:1.6;">
          <strong style="color:#14223d;">${displayName}</strong>${identityLines.length ? `<br>${identityLines.join("<br>")}` : ""}
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd4c0;color:#737b87;font-size:11px;">
            Diese Nachricht wurde automatisch erstellt. Technisch versendet über Kontor².
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function validLogoDataUri(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^data:image\/(png|jpeg);base64,[a-z0-9+/]+=*$/i.test(trimmed) ? trimmed : null;
}

function buildLogoAttachment(dataUri: string): BankDetailsConfirmationAttachment {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUri);
  const subtype = match?.[1]?.toLowerCase() === "jpeg" ? "jpeg" : "png";
  return {
    filename: `vereinslogo.${subtype === "jpeg" ? "jpg" : "png"}`,
    content: Buffer.from(match?.[2] ?? "", "base64"),
    contentType: `image/${subtype}`,
    cid: "vereinslogo@kontor2",
    contentDisposition: "inline",
  };
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
      attachments: content.attachments,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
