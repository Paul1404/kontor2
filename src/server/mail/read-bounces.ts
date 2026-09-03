import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { loadSmtpConfig } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";
import { type DsnRecipient, parseDsn } from "~/server/mail/dsn";

const IMAPS_PORT = 993;
const MAX_MESSAGES = 200;

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
 * Pull the machine-readable parts out of a parsed report. RFC 3464 puts the
 * per-recipient fields in a `message/delivery-status` part and the returned
 * headers in a `text/rfc822-headers` or `message/rfc822` part.
 */
function extractParts(parsed: Awaited<ReturnType<typeof simpleParser>>): {
  deliveryStatus: string | null;
  originalHeaders: string | null;
} {
  let deliveryStatus: string | null = null;
  let originalHeaders: string | null = null;
  for (const attachment of parsed.attachments ?? []) {
    const type = attachment.contentType?.toLowerCase() ?? "";
    const content = attachment.content?.toString("utf8") ?? "";
    if (type === "message/delivery-status") deliveryStatus ??= content;
    else if (type === "text/rfc822-headers") originalHeaders ??= content;
    else if (type === "message/rfc822") {
      // Only the header block is needed; the body may be the whole mail back.
      originalHeaders ??= content.split(/\r?\n\r?\n/, 1)[0] ?? null;
    }
  }
  return { deliveryStatus, originalHeaders };
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
export async function readBounces(
  db: DB,
  opts: { since: Date },
): Promise<{ reports: BounceReport[]; mailbox: string | null }> {
  const config = await loadSmtpConfig(db);
  if (!config?.username || !config.password) return { reports: [], mailbox: null };

  const client = createClient({
    host: config.host,
    username: config.username,
    password: config.password,
    allowInvalidCerts: config.allowInvalidCerts,
  });

  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });

    // `header` narrows to report messages server-side; the content check below
    // is what actually decides, since servers differ in how they index this.
    const uids = await client.search(
      { since: opts.since, header: { "content-type": "report" } },
      { uid: true },
    );
    if (!uids || uids.length === 0) return { reports: [], mailbox: "INBOX" };

    const reports: BounceReport[] = [];
    for (const uid of uids.slice(-MAX_MESSAGES)) {
      const fetched = await client.fetchOne(
        uid,
        { source: true, internalDate: true },
        { uid: true },
      );
      if (fetched === false || !fetched.source) continue;
      const parsed = await simpleParser(fetched.source, { skipImageLinks: true });
      const parts = extractParts(parsed);
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
    return { reports, mailbox: "INBOX" };
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}
