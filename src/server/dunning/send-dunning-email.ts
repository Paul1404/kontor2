import { sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import type { MailBlock } from "~/server/mail/layout";

const LEVEL_TITLES: Record<1 | 2 | 3, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

const LEVEL_PHRASE: Record<1 | 2 | 3, string> = {
  1: "eine Zahlungserinnerung",
  2: "die 1. Mahnung",
  3: "die 2. Mahnung",
};

export type DunningEmailContent = {
  to: string;
  subject: string;
  /** Message body as the Vorstand previews it, without the club header/footer. */
  body: string;
  /** Inbox preview line. Says something the subject does not already say. */
  preheader: string;
  greeting: string;
  blocks: MailBlock[];
  attachmentName: string;
};

export type DunningEmailParams = {
  level: 1 | 2 | 3;
  to: string;
  recipientName: string;
  vereinsname: string;
  mitgliedsnummer: string;
  totalDue: string;
  dueDate: string;
  attachmentName: string;
};

function fmtMoney(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function fmtDate(s: string): string {
  if (!s || s.length < 10) return s;
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Build the exact subject and body of the dunning email. Pure, so the
 * preview the Vorstand sees and the mail that actually goes out are byte
 * for byte the same. The detail and the bank account live in the attached
 * PDF; this text just frames it.
 */
export function buildDunningEmail(p: DunningEmailParams): DunningEmailContent {
  const title = LEVEL_TITLES[p.level];
  const greeting = `Guten Tag ${p.recipientName},`;
  const blocks: MailBlock[] = [
    {
      kind: "paragraph",
      text: `anbei erhalten Sie ${LEVEL_PHRASE[p.level]} zu noch offenen Beiträgen.`,
    },
    {
      kind: "callout",
      label: "Offener Betrag",
      value: `${fmtMoney(p.totalDue)} · fällig bis ${fmtDate(p.dueDate)}`,
    },
    {
      kind: "paragraph",
      text: "Die einzelnen Posten und unsere Bankverbindung finden Sie im angehängten PDF.",
    },
    {
      kind: "note",
      text: "Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.",
    },
  ];
  const body = [
    greeting,
    ``,
    `anbei erhalten Sie ${LEVEL_PHRASE[p.level]} zu noch offenen Beiträgen.`,
    `Der offene Gesamtbetrag beträgt ${fmtMoney(p.totalDue)} und ist bis zum ${fmtDate(p.dueDate)} zu begleichen.`,
    ``,
    `Die einzelnen Posten und unsere Bankverbindung finden Sie im angehängten PDF.`,
    `Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.`,
    ``,
    `Mit freundlichen Grüßen`,
    p.vereinsname,
  ].join("\n");
  return {
    to: p.to,
    preheader: `${fmtMoney(p.totalDue)} offen, fällig bis ${fmtDate(p.dueDate)}.`,
    subject: `${title}: Mitgliedsnummer ${p.mitgliedsnummer}`,
    body,
    greeting,
    blocks,
    attachmentName: p.attachmentName,
  };
}

/**
 * Send a dunning email with the rendered Mahnung PDF attached, in the shared
 * club design. The PDF is already stored base64-encoded on the dunning item,
 * so we attach it directly without re-rendering. The returned body is what
 * actually went out, so the caller logs the exact message.
 */
export async function sendDunningEmail(
  db: DB,
  opts: {
    content: DunningEmailContent;
    pdfBase64: string;
  },
): Promise<
  | { ok: true; bodyText: string; bodyHtml: string; messageId: string | null }
  | { ok: false; reason: string; bodyText: string; bodyHtml: string; messageId: null }
> {
  const res = await sendBrandedMail(db, {
    to: opts.content.to,
    subject: opts.content.subject,
    attachments: [
      {
        filename: opts.content.attachmentName,
        content: Buffer.from(opts.pdfBase64, "base64"),
        contentType: "application/pdf",
      },
    ],
    document: {
      preheader: opts.content.preheader,
      subline: "Offene Beiträge",
      greeting: opts.content.greeting,
      closing: "Mit freundlichen Grüßen",
      blocks: opts.content.blocks,
    },
  });
  if (res.ok) {
    return { ok: true, bodyText: res.bodyText, bodyHtml: res.bodyHtml, messageId: res.messageId };
  }
  return {
    ok: false,
    reason: res.reason,
    bodyText: res.bodyText,
    bodyHtml: res.bodyHtml,
    messageId: null,
  };
}
