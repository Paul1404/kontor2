import { ImapFlow, type ListResponse, type MessageEnvelopeObject } from "imapflow";
import { simpleParser } from "mailparser";
import { loadSmtpConfig } from "~/server/auth/send-invite";
import type { DB } from "~/server/db/client";

const IMAPS_PORT = 993;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_CANDIDATES = 50;
const MAX_TIME_DISTANCE_MS = 15 * 60 * 1000;

export type SentMessageSnapshot = {
  bodyText: string | null;
  bodyHtml: string | null;
  attachmentNames: string[];
  mailbox: string;
  messageId: string | null;
};

function sentMailbox(mailboxes: ListResponse[]): string | null {
  return (
    mailboxes.find((mailbox) => mailbox.specialUse === "\\Sent")?.path ??
    mailboxes.find((mailbox) => /(^|[./])sent($|[./])|gesendet/i.test(mailbox.path))?.path ??
    null
  );
}

function addresses(envelope: MessageEnvelopeObject | undefined): string[] {
  return [...(envelope?.to ?? []), ...(envelope?.cc ?? []), ...(envelope?.bcc ?? [])]
    .map((address) => address.address?.trim().toLowerCase())
    .filter((address): address is string => !!address);
}

async function createClient(db: DB): Promise<ImapFlow | null> {
  const config = await loadSmtpConfig(db);
  if (!config?.username || !config.password) return null;
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

async function openSentMailbox(client: ImapFlow): Promise<string | null> {
  const mailboxes = await client.list();
  const path = sentMailbox(mailboxes);
  if (!path) return null;
  await client.mailboxOpen(path, { readOnly: true });
  return path;
}

export async function testSentMailbox(db: DB): Promise<{ mailbox: string }> {
  const client = await createClient(db);
  if (!client) throw new Error("Für IMAP werden Benutzername und Passwort benötigt.");
  try {
    await client.connect();
    const mailbox = await openSentMailbox(client);
    if (!mailbox) throw new Error("Der Ordner „Gesendet“ wurde nicht gefunden.");
    return { mailbox };
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}

export async function findSentMessage(
  db: DB,
  expected: { recipient: string; subject: string; sentAt: Date },
): Promise<SentMessageSnapshot | null> {
  const client = await createClient(db);
  if (!client) return null;
  try {
    await client.connect();
    const mailbox = await openSentMailbox(client);
    if (!mailbox) return null;

    const since = new Date(expected.sentAt.getTime() - 2 * 24 * 60 * 60 * 1000);
    const before = new Date(expected.sentAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const found = await client.search(
      { subject: expected.subject, to: expected.recipient, sentSince: since, sentBefore: before },
      { uid: true },
    );
    if (!found || found.length === 0) return null;

    const candidateUids = found.slice(-MAX_CANDIDATES);
    const candidates = await client.fetchAll(
      candidateUids,
      { uid: true, envelope: true, internalDate: true, size: true },
      { uid: true },
    );
    const recipient = expected.recipient.trim().toLowerCase();
    const match = candidates
      .filter(
        (message) =>
          message.envelope?.subject === expected.subject &&
          addresses(message.envelope).includes(recipient) &&
          typeof message.size === "number" &&
          message.size <= MAX_MESSAGE_BYTES,
      )
      .map((message) => ({
        message,
        distance: Math.abs(
          new Date(message.envelope?.date ?? message.internalDate ?? 0).getTime() -
            expected.sentAt.getTime(),
        ),
      }))
      .filter((candidate) => candidate.distance <= MAX_TIME_DISTANCE_MS)
      .sort((left, right) => left.distance - right.distance)[0]?.message;
    if (!match?.uid) return null;

    const fetched = await client.fetchOne(match.uid, { source: true }, { uid: true });
    if (fetched === false || !fetched.source) return null;
    const parsed = await simpleParser(fetched.source, {
      skipImageLinks: true,
      maxHtmlLengthToParse: 5 * 1024 * 1024,
    });
    return {
      bodyText: parsed.text?.trim() || null,
      bodyHtml: parsed.html || null,
      attachmentNames: parsed.attachments
        .map((attachment) => attachment.filename)
        .filter((name): name is string => !!name),
      mailbox,
      messageId: parsed.messageId ?? null,
    };
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}
