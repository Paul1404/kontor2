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

/**
 * Undo the transfer encoding of a part. A plain-text bounce is routinely sent
 * quoted-printable, where the addresses read `=3Caddr=3E` and no pattern
 * matches, or base64, where the whole block is unreadable. Both then parsed as
 * "no recipients" and the bounce was silently dropped.
 */
function decodePart(headers: string, body: string): string {
  const encoding = (fieldsOf(headers).get("content-transfer-encoding")?.[0] ?? "")
    .trim()
    .toLowerCase();
  if (encoding === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
    } catch {
      return body;
    }
  }
  if (encoding === "quoted-printable") {
    return (
      body
        // A trailing "=" is a soft line break and joins the next line.
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    );
  }
  return body;
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
  /** Human-readable body, used when a server sends no machine-readable part. */
  text: string | null;
} {
  let deliveryStatus: string | null = null;
  let originalHeaders: string | null = null;
  let text: string | null = null;

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

    if (type === "text/plain" || (type === "" && depth > 0)) {
      text ??= decodePart(headers, body);
      return;
    }

    const boundary = type.startsWith("multipart/") ? boundaryOf(headers) : null;
    if (!boundary) {
      // A single-part bounce carries everything in its body.
      if (depth === 0) text ??= decodePart(headers, body);
      return;
    }
    for (const part of body.split(`--${boundary}`)) {
      const trimmed = part.replace(/^\r?\n/, "");
      if (!trimmed.trim() || trimmed.startsWith("--")) continue;
      walk(trimmed, depth + 1);
    }
  };

  walk(raw.replace(/\r\n/g, "\n"), 0);
  return { deliveryStatus, originalHeaders, text };
}

/**
 * Read a bounce that carries no machine-readable part at all.
 *
 * Not every mail server sends RFC 3464. Plenty still return a plain-text
 * notice, and the one that rejected the Austrittsbestätigung is among them: a
 * "Failed addresses follow:" block with the address on one line and the SMTP
 * response on the next. Insisting on the standard meant discarding exactly the
 * bounces this club actually receives.
 *
 * Deliberately conservative: an address only counts when a 4xx or 5xx response
 * sits with it, so ordinary prose mentioning an address is not mistaken for a
 * delivery failure.
 */
export function parseTextBounce(text: string): DsnRecipient[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const found = new Map<string, DsnRecipient>();
  let pending: string | null = null;

  for (const line of lines) {
    // Stop at the returned original message: addresses below belong to it.
    if (/^\|?-*\s*(message headers? follows?|original message)/i.test(line.trim())) break;

    const addresses = [...line.matchAll(/<([^<>@\s]+@[^<>\s]+)>/g)].map((m) => m[1]!.toLowerCase());
    const code = /(?:^|\s)([45]\d\d)(?:\s|$|-)/.exec(line);
    const enhanced = /(?:^|\s)([45]\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(line);

    if (!code && !enhanced) {
      // A line that is only an address announces the recipient of the next line.
      if (addresses.length === 1 && line.trim() === `<${addresses[0]}>`) pending = addresses[0]!;
      continue;
    }

    const target = addresses[0] ?? pending;
    if (!target) continue;
    pending = null;
    if (found.has(target)) continue;
    found.set(target, {
      recipient: target,
      action: "failed",
      status: enhanced?.[1] ?? null,
      diagnostic: line.trim().slice(0, 300) || null,
    });
  }

  return [...found.values()];
}

export function parseDsn(parts: {
  deliveryStatus: string | null;
  originalHeaders: string | null;
  text?: string | null;
}): ParsedDsn {
  const structured = parts.deliveryStatus ? parseDeliveryStatus(parts.deliveryStatus) : [];
  // Fall back to the prose only when the standard part is absent or empty, so a
  // proper report is never second-guessed by a text heuristic.
  const recipients = structured.length > 0 ? structured : parseTextBounce(parts.text ?? "");
  return {
    recipients,
    originalMessageId: parts.originalHeaders
      ? parseOriginalMessageId(parts.originalHeaders)
      : parts.text
        ? parseOriginalMessageId(parts.text)
        : null,
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
