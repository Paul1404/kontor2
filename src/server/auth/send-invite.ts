import nodemailer, { type Transporter } from "nodemailer";
import { type DB, db as primaryDb } from "~/server/db/client";
import { smtpConfigTable } from "~/server/db/schema/settings";
import { loadMailOrganization } from "~/server/mail/branding";
import { type MailDocument, renderMail } from "~/server/mail/layout";

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

/**
 * Attachment shape accepted by every sender. `cid` + inline disposition mark
 * an image referenced from the HTML (the club logo); a plain attachment (a
 * Mahnung or Beitrittserklärung PDF) leaves both off.
 */
export type MailSendAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
  cid?: string;
  contentDisposition?: "inline";
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

/** Strip the angle brackets so a stored id matches what a bounce report quotes. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
}

export function mailFrom(cfg: SmtpDispatchConfig): string {
  return cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress;
}

/**
 * Shared sender for ad-hoc mail. Reuses the cached transporter and the
 * configured From. Returns null when SMTP is unconfigured so callers can
 * surface a friendly precondition error.
 */
export async function getMailer(db: DB = primaryDb()): Promise<{
  send: (opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: MailSendAttachment[];
  }) => Promise<{ messageId: string | null }>;
  from: string;
} | null> {
  const cfg = await loadSmtpConfig(db);
  if (!cfg) return null;
  const t = transporterFor(cfg);
  const from = mailFrom(cfg);
  return {
    from,
    send: async (opts) => {
      const info = await t.sendMail({ ...opts, from });
      return { messageId: normalizeMessageId(info?.messageId) };
    },
  };
}

export type BrandedMailResult =
  | { ok: true; subject: string; bodyText: string; bodyHtml: string; messageId: string | null }
  | {
      ok: false;
      reason: string;
      subject: string;
      bodyText: string;
      bodyHtml: string;
      messageId: null;
    };

/**
 * Render a mail in the shared club design and dispatch it. The rendered text
 * and HTML come back either way, so a caller can log exactly what it tried to
 * send even when SMTP is down. Never throws.
 */
export async function sendBrandedMail(
  db: DB,
  opts: {
    to: string;
    subject: string;
    document: Omit<MailDocument, "organization">;
    attachments?: MailSendAttachment[];
    /** Bypass the stored config, e.g. to validate a draft SMTP setup. */
    inlineConfig?: SmtpDispatchConfig | null;
  },
): Promise<BrandedMailResult> {
  const organization = await loadMailOrganization(db);
  const rendered = renderMail({ ...opts.document, organization });
  const base = { subject: opts.subject, bodyText: rendered.text, bodyHtml: rendered.html };

  const cfg = opts.inlineConfig ?? (await loadSmtpConfig(db));
  if (!cfg) return { ok: false, reason: "smtp_not_configured", messageId: null, ...base };
  // Inline configs skip the transporter cache: the signature would match a
  // saved config and we'd accidentally reuse the wrong transport.
  const t = opts.inlineConfig ? buildTransporter(cfg) : transporterFor(cfg);
  try {
    const info = await t.sendMail({
      from: mailFrom(cfg),
      to: opts.to,
      subject: opts.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: [...rendered.attachments, ...(opts.attachments ?? [])],
    });
    return { ok: true, messageId: normalizeMessageId(info?.messageId), ...base };
  } catch (err) {
    return { ok: false, reason: (err as Error).message, messageId: null, ...base };
  }
}

/** Club display name, resilient: a mail must never fail on branding. */
async function brandName(db: DB): Promise<string> {
  return (await loadMailOrganization(db)).displayName;
}

export async function sendInviteEmail(
  db: DB,
  opts: { to: string; acceptUrl: string; invitedByName: string; role: string },
): Promise<BrandedMailResult> {
  const name = await brandName(db);
  return sendBrandedMail(db, {
    to: opts.to,
    subject: `${name}: Einladung zur Vereinsverwaltung`,
    document: {
      preheader: `${opts.invitedByName} lädt Sie zur Vereinsverwaltung ein.`,
      subline: "Zugang zur Vereinsverwaltung",
      greeting: "Hallo,",
      blocks: [
        {
          kind: "paragraph",
          text: `${opts.invitedByName} lädt Sie zur Vereinsverwaltung von ${name} ein.`,
        },
        { kind: "callout", label: "Ihre Rolle", value: opts.role },
        { kind: "button", label: "Passwort festlegen", url: opts.acceptUrl },
        { kind: "note", text: "Der Link ist 7 Tage gültig." },
      ],
    },
  });
}

export async function sendPasswordResetEmail(
  db: DB,
  opts: { to: string; resetUrl: string },
): Promise<BrandedMailResult> {
  const name = await brandName(db);
  return sendBrandedMail(db, {
    to: opts.to,
    subject: `${name}: Passwort zurücksetzen`,
    document: {
      preheader: "Setzen Sie Ihr Passwort für die Vereinsverwaltung zurück.",
      subline: "Zugang zur Vereinsverwaltung",
      greeting: "Hallo,",
      blocks: [
        {
          kind: "paragraph",
          text: `für Ihr Konto in der Vereinsverwaltung von ${name} wurde das Zurücksetzen des Passworts angefordert.`,
        },
        { kind: "button", label: "Neues Passwort vergeben", url: opts.resetUrl },
        {
          kind: "note",
          text: "Der Link ist eine Stunde gültig. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail. Ihr Passwort bleibt dann unverändert.",
        },
      ],
    },
  });
}

/**
 * Send a test mail. If `inline` is provided, the saved DB config is bypassed
 * and a one-shot transporter is built from the supplied values. Lets admins
 * validate a draft config before persisting it.
 */
export async function sendTestMail(
  db: DB,
  opts: { to: string; inline?: SmtpDispatchConfig | null },
): Promise<BrandedMailResult> {
  return sendBrandedMail(db, {
    to: opts.to,
    subject: `${await brandName(db)}: Test-E-Mail`,
    inlineConfig: opts.inline,
    document: {
      preheader: "Die SMTP-Konfiguration funktioniert.",
      subline: "Systemnachricht",
      greeting: null,
      closing: null,
      blocks: [
        {
          kind: "paragraph",
          text: "Diese Nachricht bestätigt, dass die SMTP-Konfiguration funktioniert.",
        },
        {
          kind: "note",
          text: "So sehen Ihre Vereinsmails aus: Logo, Farbe und Kontaktangaben stammen aus den Vereinsdaten.",
        },
      ],
    },
  });
}
