import nodemailer from "nodemailer";
import { loadSmtpConfig } from "~/server/auth/send-invite";

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
  body: string;
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
  const body = [
    `Guten Tag ${p.recipientName},`,
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
    subject: `${title} - Mitgliedsnummer ${p.mitgliedsnummer}`,
    body,
    attachmentName: p.attachmentName,
  };
}

/**
 * Send a dunning email with the rendered Mahnung PDF attached. The PDF is
 * already stored base64-encoded on the dunning item, so we attach it
 * directly without re-rendering.
 */
export async function sendDunningEmail(opts: {
  content: DunningEmailContent;
  pdfBase64: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await loadSmtpConfig();
  if (!cfg) return { ok: false, reason: "smtp_not_configured" };
  const t = nodemailer.createTransport({
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
    await t.sendMail({
      from,
      to: opts.content.to,
      subject: opts.content.subject,
      text: opts.content.body,
      attachments: [
        {
          filename: opts.content.attachmentName,
          content: Buffer.from(opts.pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
