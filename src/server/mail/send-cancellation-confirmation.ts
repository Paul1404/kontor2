import { formatDate } from "~/lib/format";
import type { CancellationDateMode } from "~/lib/tenant-settings";
import { type MailSendAttachment, sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import type { MailBlock } from "~/server/mail/layout";

export type CancellationConfirmationParams = {
  to: string;
  memberName: string;
  clubDisplayName: string;
  /** Day the written Austrittserklärung reached the club, `YYYY-MM-DD`. */
  noticeReceivedOn: string | null;
  /** Austrittstermin as stamped on the member, `YYYY-MM-DD`. */
  effectiveDate: string;
  dateMode: CancellationDateMode | null;
  noticeDays: number | null;
  statuteReference: string | null;
  outstandingClaimsStatuteReference: string | null;
  /** Whether the Austrittsbestätigung travels with the mail. */
  hasLetter: boolean;
};

function ruleSentence(params: CancellationConfirmationParams): string | null {
  const mode =
    params.dateMode === "year_end"
      ? "Ein Austritt ist nur zum Jahresende möglich"
      : params.dateMode === "month_end"
        ? "Ein Austritt ist nur zum Monatsende möglich"
        : null;
  const frist =
    params.noticeDays && params.noticeDays > 0
      ? `die Kündigungsfrist beträgt ${params.noticeDays} Tage`
      : null;
  const parts = [mode, frist].filter(Boolean).join(", ");
  if (!parts) return null;
  const source = params.statuteReference
    ? `Nach ${params.statuteReference} der Satzung gilt`
    : "Es gilt";
  return `${source}: ${parts}. Daraus ergibt sich der genannte Austrittstermin.`;
}

/**
 * Confirm a recorded Kündigung to the member. The Austrittstermin is the point
 * of the mail: it is derived from the day the notice arrived, and a member who
 * cancelled close to the deadline may land a full period later than expected.
 * Saying so while the decision is still fresh avoids the argument later.
 */
export function buildCancellationConfirmation(params: CancellationConfirmationParams): {
  subject: string;
  document: { preheader: string; subline: string; greeting: string; blocks: MailBlock[] };
} {
  const rule = ruleSentence(params);
  const blocks: MailBlock[] = [
    {
      kind: "paragraph",
      text: params.noticeReceivedOn
        ? `wir bestätigen den Eingang Ihrer Kündigung vom ${formatDate(params.noticeReceivedOn)} und haben Ihre Mitgliedschaft entsprechend beendet.`
        : "wir bestätigen Ihre Kündigung und haben Ihre Mitgliedschaft entsprechend beendet.",
    },
    {
      kind: "callout",
      label: "Ihre Mitgliedschaft endet am",
      value: formatDate(params.effectiveDate),
    },
    ...(rule ? ([{ kind: "note", text: rule }] as MailBlock[]) : []),
    {
      kind: "paragraph",
      text: params.outstandingClaimsStatuteReference
        ? `Bis zu diesem Tag bleiben Ihre Rechte und Pflichten als Mitglied bestehen. Bereits entstandene Beitragsforderungen bleiben auch danach offen (${params.outstandingClaimsStatuteReference} der Satzung).`
        : "Bis zu diesem Tag bleiben Ihre Rechte und Pflichten als Mitglied bestehen. Bereits entstandene Beitragsforderungen bleiben auch danach offen.",
    },
    ...(params.hasLetter
      ? ([
          { kind: "note", text: "Die schriftliche Austrittsbestätigung finden Sie im Anhang." },
        ] as MailBlock[])
      : []),
    {
      kind: "paragraph",
      text: "Sollte der genannte Termin nicht Ihrer Kündigung entsprechen, melden Sie sich bitte bei uns.",
    },
  ];

  return {
    subject: `${params.clubDisplayName}: Austritt zum ${formatDate(params.effectiveDate)}`,
    document: {
      preheader: `Ihre Mitgliedschaft endet am ${formatDate(params.effectiveDate)}.`,
      subline: "Austritt",
      greeting: `Guten Tag ${params.memberName},`,
      blocks,
    },
  };
}

export async function sendCancellationConfirmation(
  db: DB,
  params: CancellationConfirmationParams,
  attachments: MailSendAttachment[],
) {
  const content = buildCancellationConfirmation(params);
  return sendBrandedMail(db, {
    to: params.to,
    subject: content.subject,
    document: content.document,
    attachments,
  });
}
