/**
 * SEPA-Vorabankündigung (pre-notification) email text. SEPA requires the
 * creditor to announce a direct debit (amount + due date) ahead of the
 * collection. Pure builder so the wording is testable and identical to what
 * goes out.
 */

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
} {
  const subject = `Vorabankündigung SEPA-Lastschrift ${p.billingYear}`;
  const text = [
    `Guten Tag ${p.recipientName},`,
    ``,
    `wir kündigen Ihnen den Einzug des Mitgliedsbeitrags ${p.billingYear} per SEPA-Lastschrift an.`,
    ``,
    `Betrag: ${fmtMoney(p.amount)}`,
    `Fälligkeitsdatum: ${fmtDate(p.falligkeitsdatum)}`,
    `Mandatsreferenz: ${p.mandateRef}`,
    ...(p.glaeubigerId ? [`Gläubiger-Identifikationsnummer: ${p.glaeubigerId}`] : []),
    ``,
    `Bitte sorgen Sie für ausreichende Deckung Ihres Kontos.`,
    ``,
    `Mit freundlichen Grüßen`,
    p.vereinsname,
  ].join("\n");
  return { subject, text };
}
