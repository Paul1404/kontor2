import { ImapFlow } from "imapflow";
import { loadSmtpConfig } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { type DsnRecipient, extractReportParts, parseDsn } from "~/server/mail/dsn";

const IMAPS_PORT = 993;
const MAX_MESSAGES = 200;

export type BounceScan = {
  reports: BounceReport[];
  mailbox: string | null;
  /** Messages looked at in the window. Tells "nothing there" from "found nothing". */
  examined: number;
  /** Messages whose structure or sender suggested a delivery report. */
  candidates: number;
};

export type BounceReport = {
  /** IMAP UID, so a caller can tell two identical-looking reports apart. */
  uid: number;
  receivedAt: Date;
  /** Message-ID of the mail that failed, when the report returned it. */
  originalMessageId: string | null;
  recipients: DsnRecipient[];
};

function createClient(config: {
  host: string;
  username: string;
  password: string;
  allowInvalidCerts: boolean;
}): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: IMAPS_PORT,
    secure: true,
    servername: config.host,
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: !config.allowInvalidCerts },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/**
 * True when a message structure contains a delivery-status part, which is what
 * actually makes something a DSN. Walks the whole tree, because servers nest
 * reports differently.
 */
function looksLikeReport(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const candidate = node as { type?: unknown; childNodes?: unknown };
  const type = typeof candidate.type === "string" ? candidate.type.toLowerCase() : "";
  if (type === "message/delivery-status" || type === "multipart/report") return true;
  return Array.isArray(candidate.childNodes) && candidate.childNodes.some(looksLikeReport);
}

/** Mail servers announce bounces under a handful of well-known local parts. */
function isDaemonSender(address: string | undefined): boolean {
  const value = address?.toLowerCase() ?? "";
  return (
    value.startsWith("mailer-daemon@") ||
    value.startsWith("postmaster@") ||
    value.startsWith("bounce") ||
    value.includes("@bounce.")
  );
}

/**
 * Read delivery failure reports from the configured mailbox.
 *
 * The bounce lands in the same inbox the club sends from, so no extra address
 * or AWS configuration is needed. Only `multipart/report` messages are fetched:
 * a human-written "your mail did not arrive" reply is not a DSN and must not be
 * mistaken for one.
 *
 * Returns an empty list when IMAP is not configured, so a caller can run this
 * unconditionally.
 */
export async function readBounces(db: DB, opts: { since: Date }): Promise<BounceScan> {
  const config = await loadSmtpConfig(db);
  if (!config?.username || !config.password) {
    return { reports: [], mailbox: null, examined: 0, candidates: 0 };
  }

  const client = createClient({
    host: config.host,
    username: config.username,
    password: config.password,
    allowInvalidCerts: config.allowInvalidCerts,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });

    // Search by date only. Narrowing server-side on the Content-Type header
    // looked cheaper, but a server that does not index that header returns
    // nothing, which is indistinguishable from having no bounces. The structure
    // of each message is what decides, and reading it is cheap: envelope and
    // body structure come without the message body.
    const uids = await client.search({ since: opts.since }, { uid: true });
    if (!uids || uids.length === 0) {
      return { reports: [], mailbox: "INBOX", examined: 0, candidates: 0 };
    }

    const window = uids.slice(-MAX_MESSAGES);
    const candidates: number[] = [];
    for await (const message of client.fetch(
      window,
      { uid: true, envelope: true, bodyStructure: true },
      { uid: true },
    )) {
      const from = message.envelope?.from?.[0]?.address;
      if (looksLikeReport(message.bodyStructure) || isDaemonSender(from)) {
        candidates.push(message.uid);
      }
    }

    const reports: BounceReport[] = [];
    for (const uid of candidates) {
      const fetched = await client.fetchOne(
        uid,
        { source: true, internalDate: true },
        { uid: true },
      );
      if (fetched === false || !fetched.source) continue;
      const parts = extractReportParts(fetched.source.toString("utf8"));
      if (!parts.deliveryStatus) continue;
      const dsn = parseDsn(parts);
      if (dsn.recipients.length === 0) continue;
      reports.push({
        uid,
        receivedAt: fetched.internalDate ? new Date(fetched.internalDate) : new Date(),
        originalMessageId: dsn.originalMessageId,
        recipients: dsn.recipients,
      });
    }
    return {
      reports,
      mailbox: "INBOX",
      examined: window.length,
      candidates: candidates.length,
    };
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}
