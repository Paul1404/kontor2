import { darkenForWhiteText } from "~/lib/branding-color";
import {
  buildLogoAttachment,
  MAIL_LOGO_CID,
  type MailInlineAttachment,
  type MailOrganization,
} from "~/server/mail/branding";

const KONTOR_URL = "https://kontor2.com";

/**
 * One content block of a mail. Both the HTML and the plain-text alternative
 * are rendered from the same block list, so the two can never drift apart --
 * which is exactly what happened while each mail hand-wrote its own copy twice.
 */
export type MailBlock =
  | { kind: "paragraph"; text: string }
  /** Boxed highlight, e.g. the masked IBAN or an Antragsnummer. */
  | { kind: "callout"; label: string; value: string }
  /** Call to action. The plain-text alternative prints the bare URL. */
  | { kind: "button"; label: string; url: string }
  | { kind: "bullets"; items: string[] }
  /** Small print inside the body, e.g. how long a link stays valid. */
  | { kind: "note"; text: string };

export type MailDocument = {
  organization: MailOrganization;
  /** Preview line shown by the inbox next to the subject. Never rendered. */
  preheader: string;
  /** Line under the club name in the header, e.g. "Mitgliederportal". */
  subline: string;
  /** e.g. "Guten Tag Berta Beispiel," -- omitted for club-internal notices. */
  greeting?: string | null;
  blocks: MailBlock[];
  /** Defaults to "Freundliche Grüße"; pass null to drop the sign-off. */
  closing?: string | null;
  /**
   * Whether the footer claims the message was generated automatically.
   * A Rundschreiben is typed by a person, so it must not say so.
   */
  automated?: boolean;
};

export type RenderedMail = {
  html: string;
  text: string;
  attachments: MailInlineAttachment[];
};

const DEFAULT_CLOSING = "Freundliche Grüße";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Only http(s) links are emitted. A `javascript:` or `data:` URL reaching an
 * href would be an injection vector in any client that follows it, and no mail
 * this app sends has a legitimate reason to use one.
 */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function identityLines(organization: MailOrganization): string[] {
  return [
    organization.legalName !== organization.displayName ? organization.legalName : null,
    ...organization.addressLines,
    organization.contactEmail ? `E-Mail: ${organization.contactEmail}` : null,
    organization.contactPhone ? `Telefon: ${organization.contactPhone}` : null,
  ].filter((line): line is string => Boolean(line));
}

function blockToText(block: MailBlock): string[] {
  if (block.kind === "paragraph" || block.kind === "note") return [block.text, ""];
  if (block.kind === "callout") return [`${block.label}: ${block.value}`, ""];
  if (block.kind === "button") return [`${block.label}:`, block.url, ""];
  return [...block.items.map((item) => `- ${item}`), ""];
}

function blockToHtml(block: MailBlock, brandColor: string): string {
  if (block.kind === "paragraph") {
    return `<p style="margin:0 0 18px;">${escapeHtml(block.text)}</p>`;
  }
  if (block.kind === "note") {
    return `<p style="margin:0 0 18px;color:#5b6472;font-size:14px;">${escapeHtml(block.text)}</p>`;
  }
  if (block.kind === "callout") {
    return `<div style="margin:22px 0;padding:16px 18px;background:#f6f3ec;border-left:4px solid ${escapeHtml(brandColor)};border-radius:6px;">
            <div style="color:#5b6472;font-size:12px;text-transform:uppercase;letter-spacing:0.7px;">${escapeHtml(block.label)}</div>
            <div style="margin-top:4px;font-family:monospace;font-size:18px;font-weight:600;">${escapeHtml(block.value)}</div>
          </div>`;
  }
  if (block.kind === "bullets") {
    const items = block.items
      .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
      .join("");
    return `<ul style="margin:0 0 18px;padding-left:20px;">${items}</ul>`;
  }
  const href = safeUrl(block.url);
  if (!href) {
    // Never silently drop the destination: fall back to showing it as text.
    return `<p style="margin:0 0 18px;">${escapeHtml(block.label)}: ${escapeHtml(block.url)}</p>`;
  }
  const safeHref = escapeHtml(href);
  // The bar and the callout border carry no text and keep the exact club
  // colour; only this button needs white labels to stay readable on it.
  const buttonColor = escapeHtml(darkenForWhiteText(brandColor));
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 20px;"><tr>
          <td style="border-radius:6px;background:${buttonColor};">
            <a href="${safeHref}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(block.label)}</a>
          </td></tr></table>
        <p style="margin:0 0 18px;color:#5b6472;font-size:12px;word-break:break-all;">Falls der Button nicht funktioniert: ${safeHref}</p>`;
}

/**
 * Render a mail in the shared club design: brand bar, logo, body, club
 * identity footer and a discreet Kontor² credit. Returns the HTML, the
 * plain-text alternative and the inline logo attachment the HTML references.
 *
 * Every mail keeps a text part. Some members read mail in clients that never
 * show HTML, and the Versandprotokoll archives the text as the durable record.
 */
export function renderMail(doc: MailDocument): RenderedMail {
  const { organization } = doc;
  const identity = identityLines(organization);
  const closing = doc.closing === undefined ? DEFAULT_CLOSING : doc.closing;

  const text = [
    organization.displayName,
    doc.subline,
    "",
    ...(doc.greeting ? [doc.greeting, ""] : []),
    ...doc.blocks.flatMap(blockToText),
    ...(closing ? [closing, organization.displayName, ""] : []),
    ...identity,
    ...(identity.length > 0 ? [""] : []),
    ...(doc.automated === false ? [] : ["Diese Nachricht wurde automatisch erstellt."]),
    `Technisch versendet über Kontor². ${KONTOR_URL}`,
  ]
    .join("\n")
    // Collapse the blank lines that optional sections leave behind.
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  const displayName = escapeHtml(organization.displayName);
  const brandColor = escapeHtml(organization.brandColor);
  const subline = escapeHtml(doc.subline);
  const header = organization.logoDataUri
    ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="padding-right:16px;vertical-align:middle;"><img src="cid:${MAIL_LOGO_CID}" width="64" alt="" style="display:block;width:auto;max-width:64px;height:auto;max-height:64px;border:0;"></td>
          <td style="vertical-align:middle;">
            <div style="color:#14223d;font-family:Georgia,serif;font-size:25px;font-weight:600;letter-spacing:-0.3px;">${displayName}</div>
            <div style="margin-top:6px;color:#5b6472;font-size:13px;">${subline}</div>
          </td>
        </tr></table>`
    : `<div style="color:#14223d;font-family:Georgia,serif;font-size:25px;font-weight:600;letter-spacing:-0.3px;">${displayName}</div>
          <div style="margin-top:6px;color:#5b6472;font-size:13px;">${subline}</div>`;

  const body = [
    ...(doc.greeting ? [`<p style="margin:0 0 18px;">${escapeHtml(doc.greeting)}</p>`] : []),
    ...doc.blocks.map((block) => blockToHtml(block, organization.brandColor)),
    ...(closing
      ? [`<p style="margin:0;">${escapeHtml(closing)}<br><strong>${displayName}</strong></p>`]
      : []),
  ].join("\n          ");

  const html = `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f6f3ec;color:#14223d;font-family:Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(doc.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f6f3ec;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #ddd4c0;border-radius:12px;overflow:hidden;">
        <tr><td style="height:6px;background:${brandColor};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="background:#ffffff;padding:24px 28px 20px;border-bottom:1px solid #ddd4c0;">
          ${header}
        </td></tr>
        <tr><td style="padding:30px 28px;font-size:16px;line-height:1.6;">
          ${body}
        </td></tr>
        <tr><td style="border-top:1px solid #ddd4c0;background:#f6f3ec;padding:20px 28px;color:#3f4857;font-size:12px;line-height:1.6;">
          <strong style="color:#14223d;">${displayName}</strong>${identity.length ? `<br>${identity.map(escapeHtml).join("<br>")}` : ""}
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd4c0;color:#737b87;font-size:11px;">
            ${doc.automated === false ? "" : "Diese Nachricht wurde automatisch erstellt. "}Technisch versendet über <a href="${KONTOR_URL}" style="color:#737b87;text-decoration:underline;">Kontor²</a>.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return {
    html,
    text,
    attachments: organization.logoDataUri ? [buildLogoAttachment(organization.logoDataUri)] : [],
  };
}

/**
 * Turn free-form text written by the Vorstand (Rundschreiben) into blocks.
 * Blank lines separate paragraphs; the text is escaped on render, so pasted
 * markup can never become live HTML in a member's inbox.
 */
export function paragraphsFromText(value: string): MailBlock[] {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((text) => ({ kind: "paragraph", text }) as MailBlock);
}

/**
 * Make rendered mail HTML displayable in a browser. The logo travels as an
 * inline attachment, so `cid:` only resolves inside a mail client; a preview
 * pane would show a broken image instead. Swapping in the stored data URI
 * makes the preview look like the mail the member receives.
 */
export function inlineLogoForPreview(html: string, organization: MailOrganization): string {
  if (!organization.logoDataUri) return html;
  return html.replaceAll(`cid:${MAIL_LOGO_CID}`, organization.logoDataUri);
}
