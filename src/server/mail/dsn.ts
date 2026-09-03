/**
 * Delivery Status Notifications per RFC 3464. A bouncing mail server sends back
 * a `multipart/report; report-type=delivery-status` message whose
 * `message/delivery-status` part carries machine-readable fields. Parsing those
 * rather than the human-readable prose is what makes bounce handling reliable
 * across mail servers.
 *
 * Kept pure: no IMAP, no database. The reader in `read-bounces.ts` supplies the
 * already-parsed message parts.
 */

export type DsnRecipient = {
  /** Address that failed, normalised to lowercase without the addr-type prefix. */
  recipient: string;
  /** `failed` is a bounce; `delayed` is only a warning and must not count. */
  action: "failed" | "delayed" | "delivered" | "relayed" | "expanded" | "unknown";
  /** RFC 3463 status such as "5.2.2". Empty when the report omits it. */
  status: string | null;
  /** The remote server's own words, e.g. "552 Quota exceeded". */
  diagnostic: string | null;
};

export type ParsedDsn = {
  recipients: DsnRecipient[];
  /** Message-ID of the mail that failed, taken from the returned headers. */
  originalMessageId: string | null;
};

/** `rfc822; user@example.test` -> `user@example.test`. */
function stripAddrType(value: string): string {
  const semicolon = value.indexOf(";");
  const raw = semicolon >= 0 ? value.slice(semicolon + 1) : value;
  return raw.trim().replace(/^<|>$/g, "").toLowerCase();
}

/**
 * Unfold RFC 5322 headers: a line starting with whitespace continues the one
 * before it. Diagnostic codes are routinely wrapped, so folding must be undone
 * before the fields can be read.
 */
function unfold(block: string): string[] {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

function fieldsOf(block: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of unfold(block)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }
  return map;
}

function normalizeAction(value: string | undefined): DsnRecipient["action"] {
  const action = value?.trim().toLowerCase();
  if (
    action === "failed" ||
    action === "delayed" ||
    action === "delivered" ||
    action === "relayed" ||
    action === "expanded"
  ) {
    return action;
  }
  return "unknown";
}

/**
 * Parse the `message/delivery-status` body. Its per-recipient groups are
 * separated by blank lines; the first group describes the reporting MTA and
 * carries no recipient, so it drops out naturally.
 */
export function parseDeliveryStatus(body: string): DsnRecipient[] {
  const groups = body.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const recipients: DsnRecipient[] = [];
  for (const group of groups) {
    const fields = fieldsOf(group);
    const final = fields.get("final-recipient")?.[0] ?? fields.get("original-recipient")?.[0];
    if (!final) continue;
    recipients.push({
      recipient: stripAddrType(final),
      action: normalizeAction(fields.get("action")?.[0]),
      status: fields.get("status")?.[0]?.trim() || null,
      diagnostic: fields.get("diagnostic-code")?.[0]?.trim() || null,
    });
  }
  return recipients;
}

/** Pull the Message-ID out of the returned original headers. */
export function parseOriginalMessageId(headers: string): string | null {
  const value = fieldsOf(headers).get("message-id")?.[0];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed || null;
}

/** Split a raw MIME block into its header text and its body text. */
function splitHeadersAndBody(block: string): { headers: string; body: string } {
  const match = /\r?\n\r?\n/.exec(block);
  if (!match) return { headers: block, body: "" };
  return {
    headers: block.slice(0, match.index),
    body: block.slice(match.index + match[0].length),
  };
}

function boundaryOf(headers: string): string | null {
  const contentType = fieldsOf(headers).get("content-type")?.[0] ?? "";
  const match = /boundary\s*=\s*("([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[2] ?? match?.[3] ?? null;
}

function contentTypeOf(headers: string): string {
  return (fieldsOf(headers).get("content-type")?.[0] ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

/**
 * Pull the report parts straight out of the raw message.
 *
 * Written by hand on purpose: a general-purpose mail parser drops the
 * `message/delivery-status` part, because it is neither body text nor a
 * conventional attachment. Relying on one meant every bounce was read as
 * "no report" and silently discarded. The structure here is small and fixed by
 * RFC 3464, so splitting it directly is both shorter and more dependable.
 */
export function extractReportParts(raw: string): {
  deliveryStatus: string | null;
  originalHeaders: string | null;
} {
  let deliveryStatus: string | null = null;
  let originalHeaders: string | null = null;

  const walk = (block: string, depth: number): void => {
    if (depth > 5) return;
    const { headers, body } = splitHeadersAndBody(block);
    const type = contentTypeOf(headers);

    if (type === "message/delivery-status") {
      deliveryStatus ??= body;
      return;
    }
    if (type === "text/rfc822-headers") {
      originalHeaders ??= body;
      return;
    }
    if (type === "message/rfc822") {
      // Only the returned header block is of interest; the body may be the
      // entire original message.
      originalHeaders ??= splitHeadersAndBody(body).headers;
      return;
    }

    const boundary = type.startsWith("multipart/") ? boundaryOf(headers) : null;
    if (!boundary) return;
    for (const part of body.split(`--${boundary}`)) {
      const trimmed = part.replace(/^\r?\n/, "");
      if (!trimmed.trim() || trimmed.startsWith("--")) continue;
      walk(trimmed, depth + 1);
    }
  };

  walk(raw.replace(/\r\n/g, "\n"), 0);
  return { deliveryStatus, originalHeaders };
}

export function parseDsn(parts: {
  deliveryStatus: string | null;
  originalHeaders: string | null;
}): ParsedDsn {
  return {
    recipients: parts.deliveryStatus ? parseDeliveryStatus(parts.deliveryStatus) : [],
    originalMessageId: parts.originalHeaders ? parseOriginalMessageId(parts.originalHeaders) : null,
  };
}

/**
 * A permanent failure (5.x.x) means the address is wrong or gone; a transient
 * one (4.x.x, e.g. a full mailbox) may well deliver later. Both are worth
 * recording, but only a permanent failure should stop future sends on its own.
 */
export function isPermanent(recipient: DsnRecipient): boolean {
  if (recipient.action !== "failed") return false;
  if (recipient.status) return recipient.status.startsWith("5");
  // Without a status field, fall back to the leading code in the diagnostic.
  return /(^|\s)5\d\d(\s|-|$)/.test(recipient.diagnostic ?? "");
}

/** Short German wording for the member page and the Wiedervorlage. */
export function describeBounce(recipient: DsnRecipient): string {
  const status = recipient.status ?? "";
  if (status.startsWith("5.1")) return "Adresse existiert nicht";
  if (status === "5.2.2" || status.startsWith("4.2.2")) return "Postfach voll";
  if (status.startsWith("5.2")) return "Postfach nicht verfügbar";
  if (status.startsWith("5.7")) return "Vom Empfänger abgelehnt";
  if (status.startsWith("4")) return "Vorübergehend nicht zustellbar";
  return recipient.diagnostic?.slice(0, 200) || "Nicht zustellbar";
}
