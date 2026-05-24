import nodemailer, { type Transporter } from "nodemailer";
import { db } from "~/server/db/client";
import { smtpConfigTable } from "~/server/db/schema/settings";

let cachedTransport: { signature: string; transporter: Transporter } | undefined;

export type SmtpDispatchConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  allowInvalidCerts: boolean;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
};

export async function loadSmtpConfig(): Promise<SmtpDispatchConfig | null> {
  const rows = await db().select().from(smtpConfigTable).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    host: row.host,
    port: row.port,
    secure: row.secure,
    requireTls: row.requireTls,
    allowInvalidCerts: row.allowInvalidCerts,
    username: row.username,
    password: row.passwordEncrypted ?? null,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
  };
}

function transporterFor(cfg: SmtpDispatchConfig): Transporter {
  const sig = JSON.stringify({
    h: cfg.host,
    p: cfg.port,
    s: cfg.secure,
    rt: cfg.requireTls,
    ai: cfg.allowInvalidCerts,
    u: cfg.username,
    pw: cfg.password ? "set" : "unset",
  });
  if (cachedTransport && cachedTransport.signature === sig) return cachedTransport.transporter;
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.requireTls,
    auth: cfg.username
      ? { user: cfg.username, pass: cfg.password ?? "" }
      : undefined,
    tls: {
      // Send SNI with the configured hostname so the MTA returns the right cert.
      servername: cfg.host,
      // Some self-hosted MTAs have certs without DNS SANs or with mismatched
      // names; the admin can opt-in to skip verification.
      rejectUnauthorized: !cfg.allowInvalidCerts,
      minVersion: "TLSv1.2",
    },
  });
  cachedTransport = { signature: sig, transporter: t };
  return t;
}

export async function sendInviteEmail(opts: {
  to: string;
  acceptUrl: string;
  invitedByName: string;
  role: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await loadSmtpConfig();
  if (!cfg) return { ok: false, reason: "smtp_not_configured" };
  const t = transporterFor(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject: "Einladung zur SVUWV Vereinsverwaltung",
      text: [
        `Hallo,`,
        ``,
        `${opts.invitedByName} lädt Sie zur SVUWV Vereinsverwaltung ein.`,
        `Rolle: ${opts.role}`,
        ``,
        `Bitte folgen Sie dem Link und legen Sie ein Passwort fest:`,
        opts.acceptUrl,
        ``,
        `Der Link ist 7 Tage gültig.`,
      ].join("\n"),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function sendTestMail(opts: { to: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await loadSmtpConfig();
  if (!cfg) return { ok: false, reason: "smtp_not_configured" };
  const t = transporterFor(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject: "SVUWV: Test-E-Mail",
      text: "Diese Nachricht bestätigt, dass die SMTP-Konfiguration funktioniert.",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
