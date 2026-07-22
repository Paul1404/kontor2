import nodemailer from "nodemailer";
import { loadSmtpConfig } from "~/server/auth/send-invite";
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
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await loadSmtpConfig(db);
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
      to: opts.to,
      subject: `${opts.vereinsname}: Zugang zum Mitgliederportal`,
      text: [
        `Hallo ${opts.memberName},`,
        ``,
        `der ${opts.vereinsname} hat für Sie einen einmaligen Zugang zum Mitgliederportal`,
        `freigeschaltet. Über das Portal können Sie Ihre persönlichen Daten einsehen und`,
        `Änderungen vorschlagen. Die Änderungen werden vom Vorstand geprüft und übernommen.`,
        ``,
        `Bitte folgen Sie diesem Link:`,
        opts.portalUrl,
        ``,
        `Der Link ist gültig bis ${opts.expiresAt.toLocaleDateString("de-DE")}.`,
        `Beim ersten Aufruf wird ein dauerhafter Cookie für 30 Tage gesetzt.`,
        ``,
        `Falls Sie diesen Zugang nicht angefordert haben, ignorieren Sie diese Nachricht.`,
      ].join("\n"),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
