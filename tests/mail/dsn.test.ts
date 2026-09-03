import { describe, expect, it } from "vitest";
import {
  describeBounce,
  extractReportParts,
  isPermanent,
  parseDeliveryStatus,
  parseDsn,
  parseOriginalMessageId,
  parseTextBounce,
} from "~/server/mail/dsn";

/** The report t-online returned for the Austrittsbestätigung. */
const QUOTA_EXCEEDED = [
  "Reporting-MTA: dns; mailin26.mgt.mul.t-online.de",
  "",
  "Final-Recipient: rfc822; hls-gock@t-online.de",
  "Action: failed",
  "Status: 5.2.2",
  "Diagnostic-Code: smtp; 552 5.2.2 <hls-gock@t-online.de> Quota exceeded",
  " (mailbox for user is full)",
].join("\r\n");

describe("parseDeliveryStatus", () => {
  it("reads the failing recipient out of a real report", () => {
    const [row] = parseDeliveryStatus(QUOTA_EXCEEDED);
    expect(row?.recipient).toBe("hls-gock@t-online.de");
    expect(row?.action).toBe("failed");
    expect(row?.status).toBe("5.2.2");
    // The folded continuation line belongs to the diagnostic.
    expect(row?.diagnostic).toContain("Quota exceeded");
    expect(row?.diagnostic).toContain("mailbox for user is full");
  });

  it("ignores the reporting MTA group, which names no recipient", () => {
    expect(parseDeliveryStatus(QUOTA_EXCEEDED)).toHaveLength(1);
  });

  it("handles several recipients in one report", () => {
    const body = [
      "Reporting-MTA: dns; mx.example.test",
      "",
      "Final-Recipient: rfc822; a@example.test",
      "Action: failed",
      "Status: 5.1.1",
      "",
      "Final-Recipient: rfc822; b@example.test",
      "Action: delivered",
      "Status: 2.0.0",
    ].join("\n");
    const rows = parseDeliveryStatus(body);
    expect(rows.map((r) => r.recipient)).toEqual(["a@example.test", "b@example.test"]);
    expect(rows.map((r) => r.action)).toEqual(["failed", "delivered"]);
  });

  it("normalises addresses and falls back to Original-Recipient", () => {
    const rows = parseDeliveryStatus(
      ["Original-Recipient: rfc822; <Erika.Muster@Example.TEST>", "Action: failed"].join("\n"),
    );
    expect(rows[0]?.recipient).toBe("erika.muster@example.test");
  });

  it("returns nothing for a body that carries no recipient", () => {
    expect(parseDeliveryStatus("Reporting-MTA: dns; mx.example.test")).toEqual([]);
  });
});

describe("parseOriginalMessageId", () => {
  it("takes the id out of the returned headers and strips the brackets", () => {
    const headers = [
      'From: "SV" <svu@kontor2.com>',
      "To: hls-gock@t-online.de",
      "Subject: SV Untereuerheim: Austritt zum 31.12.2026",
      "Message-ID: <010701a067cae8ec-b74de7c6@eu-central-1.amazonses.com>",
    ].join("\r\n");
    expect(parseOriginalMessageId(headers)).toBe(
      "010701a067cae8ec-b74de7c6@eu-central-1.amazonses.com",
    );
  });

  it("returns null when there is no Message-ID", () => {
    expect(parseOriginalMessageId("Subject: ohne id")).toBeNull();
  });
});

describe("parseDsn", () => {
  it("combines both parts", () => {
    const parsed = parseDsn({
      deliveryStatus: QUOTA_EXCEEDED,
      originalHeaders: "Message-ID: <abc@kontor2.com>",
    });
    expect(parsed.recipients[0]?.recipient).toBe("hls-gock@t-online.de");
    expect(parsed.originalMessageId).toBe("abc@kontor2.com");
  });

  it("survives a report with missing parts", () => {
    expect(parseDsn({ deliveryStatus: null, originalHeaders: null })).toEqual({
      recipients: [],
      originalMessageId: null,
    });
  });
});

describe("isPermanent", () => {
  it("treats a full mailbox as temporary, so the address is not condemned", () => {
    const [row] = parseDeliveryStatus(QUOTA_EXCEEDED);
    // 5.2.2 is formally permanent, and the address really is unusable now.
    expect(isPermanent(row!)).toBe(true);
  });

  it("does not treat a delay warning as a bounce", () => {
    expect(
      isPermanent({
        recipient: "a@example.test",
        action: "delayed",
        status: "4.4.1",
        diagnostic: null,
      }),
    ).toBe(false);
  });

  it("treats a 4.x.x failure as temporary", () => {
    expect(
      isPermanent({
        recipient: "a@example.test",
        action: "failed",
        status: "4.2.2",
        diagnostic: null,
      }),
    ).toBe(false);
  });

  it("falls back to the diagnostic when the status field is missing", () => {
    expect(
      isPermanent({
        recipient: "a@example.test",
        action: "failed",
        status: null,
        diagnostic: "smtp; 550 unknown user",
      }),
    ).toBe(true);
  });
});

describe("describeBounce", () => {
  it("puts a readable reason on the common cases", () => {
    const cases: Array<[string, string]> = [
      ["5.1.1", "Adresse existiert nicht"],
      ["5.2.2", "Postfach voll"],
      ["5.7.1", "Vom Empfänger abgelehnt"],
      ["4.4.1", "Vorübergehend nicht zustellbar"],
    ];
    for (const [status, expected] of cases) {
      expect(
        describeBounce({ recipient: "a@example.test", action: "failed", status, diagnostic: null }),
      ).toBe(expected);
    }
  });

  it("falls back to the server's own words", () => {
    expect(
      describeBounce({
        recipient: "a@example.test",
        action: "failed",
        status: null,
        diagnostic: "smtp; 553 sorry, no mailbox here",
      }),
    ).toContain("no mailbox here");
  });
});

/**
 * A complete bounce as a mail server returns it. The earlier tests only fed the
 * inner delivery-status block straight in, which meant nothing ever exercised
 * getting that block out of a real message: the general-purpose mail parser
 * used at the time dropped it, so every bounce was read as "no report" while
 * these tests stayed green.
 */
const FULL_BOUNCE = [
  "From: MAILER-DAEMON@eu-central-1.amazonses.com",
  "To: svu@kontor2.com",
  "Subject: Mail delivery failed: returning message to sender",
  'Content-Type: multipart/report; report-type=delivery-status; boundary="BOUND"',
  "MIME-Version: 1.0",
  "",
  "--BOUND",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "This message was created automatically by mail delivery software.",
  "",
  "--BOUND",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; mailin26.mgt.mul.t-online.de",
  "",
  "Final-Recipient: rfc822; hls-gock@t-online.de",
  "Action: failed",
  "Status: 5.2.2",
  "Diagnostic-Code: smtp; 552 5.2.2 <hls-gock@t-online.de> Quota exceeded",
  " (mailbox for user is full)",
  "",
  "--BOUND",
  "Content-Type: message/rfc822",
  "",
  'From: "SV" <svu@kontor2.com>',
  "To: hls-gock@t-online.de",
  "Subject: SV Untereuerheim: Austritt zum 31.12.2026",
  "Message-ID: <010701a067cae8ec@eu-central-1.amazonses.com>",
  "",
  "Guten Tag,",
  "",
  "--BOUND--",
  "",
].join("\r\n");

describe("extractReportParts", () => {
  it("gets the delivery-status block out of a whole bounce message", () => {
    const parts = extractReportParts(FULL_BOUNCE);
    expect(parts.deliveryStatus).toContain("Final-Recipient: rfc822; hls-gock@t-online.de");
    expect(parts.deliveryStatus).toContain("Status: 5.2.2");
  });

  it("returns the original headers without the returned body", () => {
    const parts = extractReportParts(FULL_BOUNCE);
    expect(parts.originalHeaders).toContain(
      "Message-ID: <010701a067cae8ec@eu-central-1.amazonses.com>",
    );
    expect(parts.originalHeaders).not.toContain("Guten Tag,");
  });

  it("carries a whole bounce through to recipient and message id", () => {
    const parsed = parseDsn(extractReportParts(FULL_BOUNCE));
    expect(parsed.recipients[0]?.recipient).toBe("hls-gock@t-online.de");
    expect(parsed.recipients[0]?.status).toBe("5.2.2");
    expect(parsed.originalMessageId).toBe("010701a067cae8ec@eu-central-1.amazonses.com");
  });

  it("accepts an unquoted boundary and CRLF or LF line endings", () => {
    const unquoted = FULL_BOUNCE.replace('boundary="BOUND"', "boundary=BOUND").replace(
      /\r\n/g,
      "\n",
    );
    expect(extractReportParts(unquoted).deliveryStatus).toContain("Status: 5.2.2");
  });

  it("prefers text/rfc822-headers when the server returns only headers", () => {
    const headersOnly = FULL_BOUNCE.replace(
      "Content-Type: message/rfc822",
      "Content-Type: text/rfc822-headers",
    );
    expect(extractReportParts(headersOnly).originalHeaders).toContain("Message-ID:");
  });

  it("finds no report in an ordinary mail", () => {
    const plain = [
      "From: a@example.test",
      "To: b@example.test",
      "Subject: Kein Bericht",
      "Content-Type: text/plain",
      "",
      "Hallo",
      "",
    ].join("\r\n");
    const parts = extractReportParts(plain);
    expect(parts.deliveryStatus).toBeNull();
    expect(parts.originalHeaders).toBeNull();
    // The body is handed over for the text fallback, but it names no failure.
    expect(parseDsn(parts).recipients).toEqual([]);
  });
});

/**
 * The bounce that actually arrived for the Austrittsbestätigung. No
 * machine-readable part at all: the address on one line, the SMTP response on
 * the next. Requiring RFC 3464 meant discarding exactly this.
 */
const TEXT_BOUNCE = [
  "From: MAILER-DAEMON@eu-central-1.amazonses.com",
  "To: svu@kontor2.com",
  "Subject: Mail delivery failed: returning message to sender",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "|------------------------- Failed addresses follow: --------------------|",
  "<hls-gock@t-online.de>",
  "  552 5.2.2 <hls-gock@t-online.de> Quota exceeded (mailbox for user is full)",
  "",
  "|------------------------- Message header follows: ---------------------|",
  "Message-ID: <010701a06719dbe9@eu-central-1.amazonses.com>",
  "To: hls-gock@t-online.de",
  "Subject: SV Untereuerheim: Austritt zum 31.12.2026",
  "",
].join("\r\n");

describe("plain-text bounces", () => {
  it("reads the failed recipient out of the real report", () => {
    const parsed = parseDsn(extractReportParts(TEXT_BOUNCE));
    expect(parsed.recipients).toHaveLength(1);
    expect(parsed.recipients[0]?.recipient).toBe("hls-gock@t-online.de");
    expect(parsed.recipients[0]?.action).toBe("failed");
    expect(parsed.recipients[0]?.status).toBe("5.2.2");
    expect(parsed.recipients[0]?.diagnostic).toContain("Quota exceeded");
  });

  it("counts as permanent and reads as a full mailbox", () => {
    const [row] = parseDsn(extractReportParts(TEXT_BOUNCE)).recipients;
    expect(isPermanent(row!)).toBe(true);
    expect(describeBounce(row!)).toBe("Postfach voll");
  });

  it("still finds the original message id", () => {
    expect(parseDsn(extractReportParts(TEXT_BOUNCE)).originalMessageId).toBe(
      "010701a06719dbe9@eu-central-1.amazonses.com",
    );
  });

  it("ignores addresses below the returned original message", () => {
    // "To: hls-gock@..." appears again in the quoted headers; it must not
    // produce a second recipient, and neither must the subject line.
    expect(parseDsn(extractReportParts(TEXT_BOUNCE)).recipients).toHaveLength(1);
  });

  it("needs a status code, not just an address", () => {
    expect(parseTextBounce("Bitte wenden Sie sich an <info@example.test> für Rückfragen.")).toEqual(
      [],
    );
  });

  it("reads an address and code on the same line", () => {
    const rows = parseTextBounce("550 5.1.1 <weg@example.test>: Recipient address rejected");
    expect(rows[0]?.recipient).toBe("weg@example.test");
    expect(rows[0]?.status).toBe("5.1.1");
  });

  it("does not let the text heuristic override a proper report", () => {
    const parsed = parseDsn({
      deliveryStatus: QUOTA_EXCEEDED,
      originalHeaders: null,
      text: "550 <ganz-anders@example.test> abgelehnt",
    });
    expect(parsed.recipients).toHaveLength(1);
    expect(parsed.recipients[0]?.recipient).toBe("hls-gock@t-online.de");
  });
});

/**
 * Mail servers routinely encode the body. Quoted-printable turns the address
 * into `=3Cadr=3E`, base64 makes the whole block unreadable, and both used to
 * parse as "no recipients" and drop the bounce without a trace.
 */
describe("transfer-encoded bounces", () => {
  const inner = [
    "|------------------------- Failed addresses follow: --------------------|",
    "<alt.mitglied@t-online.de>",
    "  550 5.1.1 <alt.mitglied@t-online.de> User unknown",
    "",
  ].join("\r\n");

  function wrap(encoding: string, body: string) {
    return [
      "From: MAILER-DAEMON@example.test",
      "To: svu@kontor2.com",
      "Subject: Mail delivery failed",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Transfer-Encoding: ${encoding}`,
      "",
      body,
    ].join("\r\n");
  }

  it("reads a quoted-printable bounce", () => {
    const qp = inner
      .replace(/</g, "=3C")
      .replace(/>/g, "=3E")
      // A soft line break in the middle of the diagnostic, as servers produce.
      .replace("User unknown", "User=\r\n unknown");
    const parsed = parseDsn(extractReportParts(wrap("quoted-printable", qp)));
    expect(parsed.recipients[0]?.recipient).toBe("alt.mitglied@t-online.de");
    expect(parsed.recipients[0]?.status).toBe("5.1.1");
  });

  it("reads a base64 bounce", () => {
    const encoded = Buffer.from(inner, "utf8")
      .toString("base64")
      .replace(/(.{76})/g, "$1\r\n");
    const parsed = parseDsn(extractReportParts(wrap("base64", encoded)));
    expect(parsed.recipients[0]?.recipient).toBe("alt.mitglied@t-online.de");
  });

  it("leaves an unencoded bounce untouched", () => {
    const parsed = parseDsn(extractReportParts(wrap("7bit", inner)));
    expect(parsed.recipients[0]?.recipient).toBe("alt.mitglied@t-online.de");
  });
});
