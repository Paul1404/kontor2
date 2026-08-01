import nodemailer, { type Transporter } from "nodemailer";
import { orgDisplayName } from "~/server/branding/org-name";
import { type DB, db as primaryDb } from "~/server/db/client";
import { smtpConfigTable } from "~/server/db/schema/settings";

/**
 * Vereinsname für E-Mail-Betreff und -Text: Anzeigename, sonst voller
 * Vereinsname, sonst neutral. Aus der DB des jeweiligen Vereins. Resilient --
 * ein Mailversand soll nie an der Marke scheitern.
 */
async function brandName(db: DB): Promise<string> {
  return orgDisplayName(db);
}

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

// `db` defaults to the primary Verein. Callers on a tenant-specific path (the
// auth mails below) pass that Verein's db so the SMTP config comes from there.
// Broader mail callers (dunning, Rundschreiben, fee-runs, applications) still
// use the primary for now -- making those per-Verein is a follow-up.
export async function loadSmtpConfig(db: DB = primaryDb()): Promise<SmtpDispatchConfig | null> {
  const rows = await db.select().from(smtpConfigTable).limit(1);
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

function buildTransporter(cfg: SmtpDispatchConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure && cfg.requireTls,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
    tls: {
      // Send SNI with the configured hostname so the MTA returns the right cert.
      servername: cfg.host,
      // Some self-hosted MTAs have certs without DNS SANs or with mismatched
      // names; the admin can opt-in to skip verification.
      rejectUnauthorized: !cfg.allowInvalidCerts,
      minVersion: "TLSv1.2",
    },
  });
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
  const t = buildTransporter(cfg);
  cachedTransport = { signature: sig, transporter: t };
  return t;
}

/**
 * Shared sender for ad-hoc mail (e.g. Rundschreiben). Reuses the cached
 * transporter and the configured From. Returns null when SMTP is unconfigured
 * so callers can surface a friendly precondition error.
 */
export async function getMailer(db: DB = primaryDb()): Promise<{
  send: (opts: { to: string; subject: string; text: string; html?: string }) => Promise<void>;
  from: string;
} | null> {
  const cfg = await loadSmtpConfig(db);
  if (!cfg) return null;
  const t = transporterFor(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  return {
    from,
    send: async (opts) => {
      await t.sendMail({ ...opts, from });
    },
  };
}

export async function sendInviteEmail(
  db: DB,
  opts: {
    to: string;
    acceptUrl: string;
    invitedByName: string;
    role: string;
  },
): Promise<{ ok: true; subject: string } | { ok: false; reason: string; subject: string }> {
  const name = await brandName(db);
  const subject = `Einladung zur Vereinsverwaltung – ${name}`;
  const cfg = await loadSmtpConfig(db);
  if (!cfg) return { ok: false, reason: "smtp_not_configured", subject };
  const t = transporterFor(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject,
      text: [
        `Hallo,`,
        ``,
        `${opts.invitedByName} lädt Sie zur Vereinsverwaltung von ${name} ein.`,
        `Rolle: ${opts.role}`,
        ``,
        `Bitte folgen Sie dem Link und legen Sie ein Passwort fest:`,
        opts.acceptUrl,
        ``,
        `Der Link ist 7 Tage gültig.`,
      ].join("\n"),
    });
    return { ok: true, subject };
  } catch (err) {
    return { ok: false, reason: (err as Error).message, subject };
  }
}

export async function sendPasswordResetEmail(
  db: DB,
  opts: {
    to: string;
    resetUrl: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = await loadSmtpConfig(db);
  if (!cfg) return { ok: false, reason: "smtp_not_configured" };
  const t = transporterFor(cfg);
  const name = await brandName(db);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject: "Passwort zurücksetzen",
      text: [
        `Hallo,`,
        ``,
        `für Ihr Konto in der Vereinsverwaltung von ${name} wurde das Zurücksetzen des`,
        `Passworts angefordert. Folgen Sie dem Link und vergeben Sie ein neues Passwort:`,
        opts.resetUrl,
        ``,
        `Der Link ist eine Stunde gültig. Wenn Sie das nicht waren, ignorieren Sie`,
        `diese E-Mail. Ihr Passwort bleibt dann unverändert.`,
      ].join("\n"),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/**
 * Send a test mail. If `inline` is provided, the saved DB config is bypassed
 * and a one-shot transporter is built from the supplied values. Lets admins
 * validate a draft config before persisting it.
 */
export async function sendTestMail(
  db: DB,
  opts: {
    to: string;
    inline?: SmtpDispatchConfig | null;
  },
): Promise<{ ok: true; subject: string } | { ok: false; reason: string; subject: string }> {
  const subject = `${await brandName(db)}: Test-E-Mail`;
  const cfg = opts.inline ?? (await loadSmtpConfig(db));
  if (!cfg) return { ok: false, reason: "smtp_not_configured", subject };
  // Inline configs skip the transporter cache: the signature would match a
  // saved config and we'd accidentally reuse the wrong transport.
  const t = opts.inline ? buildTransporter(cfg) : transporterFor(cfg);
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
  try {
    await t.sendMail({
      from,
      to: opts.to,
      subject,
      text: "Diese Nachricht bestätigt, dass die SMTP-Konfiguration funktioniert.",
    });
    return { ok: true, subject };
  } catch (err) {
    return { ok: false, reason: (err as Error).message, subject };
  }
}
