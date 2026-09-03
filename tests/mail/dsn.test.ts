import { describe, expect, it } from "vitest";
import {
  describeBounce,
  isPermanent,
  parseDeliveryStatus,
  parseDsn,
  parseOriginalMessageId,
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
