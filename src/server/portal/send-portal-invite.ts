import { formatDate } from "~/lib/format";
import { type BrandedMailResult, sendBrandedMail } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";

export async function sendPortalInvite(
  db: DB,
  opts: {
    to: string;
    memberName: string;
    vereinsname: string;
    portalUrl: string;
    expiresAt: Date;
  },
): Promise<BrandedMailResult> {
  return sendBrandedMail(db, {
    to: opts.to,
    subject: `${opts.vereinsname}: Zugang zum Mitgliederportal`,
    document: {
      preheader: "Ihr persönlicher Zugang zum Mitgliederportal.",
      subline: "Mitgliederportal",
      greeting: `Hallo ${opts.memberName},`,
      blocks: [
        {
          kind: "paragraph",
          text: `${opts.vereinsname} hat für Sie einen persönlichen Zugang zum Mitgliederportal freigeschaltet. Dort können Sie Ihre Daten einsehen und Änderungen vorschlagen. Der Vorstand prüft die Änderungen und übernimmt sie.`,
        },
        { kind: "button", label: "Portal öffnen", url: opts.portalUrl },
        {
          kind: "note",
          text: `Der Link ist gültig bis ${formatDate(opts.expiresAt)}. Danach bleiben Sie auf diesem Gerät 30 Tage angemeldet.`,
        },
        {
          kind: "note",
          text: "Falls Sie diesen Zugang nicht angefordert haben, ignorieren Sie diese Nachricht.",
        },
      ],
    },
  });
}
