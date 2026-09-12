/**
 * SEPA-Vorabankündigung (pre-notification) email text. SEPA requires the
 * creditor to announce a direct debit (amount + due date) ahead of the
 * collection. The structured document feeds the shared text and HTML renderer;
 * the legacy `text` return stays for callers/tests that only need the wording.
 */

import type { MailDocument } from "~/server/mail/layout";

export type PrenotificationParams = {
  recipientName: string;
  vereinsname: string;
  glaeubigerId: string | null;
  mandateRef: string;
  amount: string;
  falligkeitsdatum: string; // ISO yyyy-mm-dd
  billingYear: number;
};

function fmtMoney(s: string): string {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function fmtDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function buildPrenotificationEmail(p: PrenotificationParams): {
  subject: string;
  text: string;
  document: Omit<MailDocument, "organization">;
} {
  const subject = `Vorabankündigung SEPA-Lastschrift ${p.billingYear}`;
  const amount = fmtMoney(p.amount);
  const dueDate = fmtDate(p.falligkeitsdatum);
  const text = [
    `Guten Tag ${p.recipientName},`,
    ``,
    `wir kündigen Ihnen den Einzug des Mitgliedsbeitrags ${p.billingYear} per SEPA-Lastschrift an.`,
    ``,
    `Betrag: ${amount}`,
    `Fälligkeitsdatum: ${dueDate}`,
    `Mandatsreferenz: ${p.mandateRef}`,
    ...(p.glaeubigerId ? [`Gläubiger-Identifikationsnummer: ${p.glaeubigerId}`] : []),
    ``,
    `Bitte sorgen Sie für ausreichende Deckung Ihres Kontos.`,
    ``,
    `Mit freundlichen Grüßen`,
    p.vereinsname,
  ].join("\n");
  return {
    subject,
    text,
    document: {
      preheader: `${amount} werden am ${dueDate} per SEPA-Lastschrift eingezogen.`,
      subline: "SEPA-Lastschrift",
      greeting: `Guten Tag ${p.recipientName},`,
      closing: "Mit freundlichen Grüßen",
      blocks: [
        {
          kind: "paragraph",
          text: `wir kündigen Ihnen den Einzug des Mitgliedsbeitrags ${p.billingYear} per SEPA-Lastschrift an.`,
        },
        { kind: "callout", label: "Betrag", value: amount },
        { kind: "callout", label: "Fälligkeitsdatum", value: dueDate },
        { kind: "callout", label: "Mandatsreferenz", value: p.mandateRef },
        ...(p.glaeubigerId
          ? [
              {
                kind: "callout" as const,
                label: "Gläubiger-Identifikationsnummer",
                value: p.glaeubigerId,
              },
            ]
          : []),
        { kind: "note", text: "Bitte sorgen Sie für ausreichende Deckung Ihres Kontos." },
      ],
    },
  };
}
