import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/server/db/client";

const loadOrganization = vi.hoisted(() => vi.fn());

vi.mock("~/server/mail/send-bank-details-confirmation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("~/server/mail/send-bank-details-confirmation")>();
  return { ...original, loadBankDetailsConfirmationOrganization: loadOrganization };
});

import { reconstructSentMessage } from "~/server/mail/reconstruct-sent-mail";

const SENT_AT = new Date("2026-08-01T17:15:00.000Z");

function fakeDb(rows: Array<Record<string, unknown>>): DB {
  const query = {
    from: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => query) } as unknown as DB;
}

describe("sent-mail reconstruction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOrganization.mockResolvedValue({
      displayName: "SV Untereuerheim",
      legalName: "Sportverein 1945 Untereuerheim e.V.",
      addressLines: ["Musterstraße 1", "97508 Grettstadt"],
      contactEmail: "mitgliedschaft@example.test",
      contactPhone: null,
      brandColor: "#a6864e",
      logoDataUri: null,
    });
  });

  it("rebuilds a bank confirmation from the change receipt and matching member snapshot", async () => {
    const result = await reconstructSentMessage(
      fakeDb([
        {
          appliedAt: new Date(SENT_AT.getTime() - 2_000),
          newIbanLast4: "1234",
          debitSuspended: false,
          member: { vorname: "Lorin", nachname: "Hümpfer" },
        },
      ]),
      {
        kind: "bank_details_confirmation",
        entityType: "member",
        entityId: "25c3649d-2da7-4d16-8b39-1f7d344272c0",
        recipient: "lorin@example.test",
        subject: "SV Untereuerheim: Bankverbindung geändert",
        sentAt: SENT_AT,
      },
    );

    expect(result?.bodyText).toContain("Guten Tag Lorin Hümpfer,");
    expect(result?.bodyText).toContain("•••• 1234");
    expect(result?.bodyHtml).toContain("IBAN endet auf •••• 1234");
    expect(result?.attachmentNames).toEqual([]);
  });

  it("does not invent content for message kinds without preserved reconstruction inputs", async () => {
    const database = fakeDb([]);
    await expect(
      reconstructSentMessage(database, {
        kind: "invite",
        entityType: "user",
        entityId: "user-1",
        recipient: "person@example.test",
        subject: "Einladung",
        sentAt: SENT_AT,
      }),
    ).resolves.toBeNull();
    expect(database.select).not.toHaveBeenCalled();
  });

  it("rejects a reconstruction when the historical subject does not match", async () => {
    await expect(
      reconstructSentMessage(
        fakeDb([
          {
            appliedAt: SENT_AT,
            newIbanLast4: "1234",
            debitSuspended: false,
            member: { vorname: "Lorin", nachname: "Hümpfer" },
          },
        ]),
        {
          kind: "bank_details_confirmation",
          entityType: "member",
          entityId: "25c3649d-2da7-4d16-8b39-1f7d344272c0",
          recipient: "lorin@example.test",
          subject: "Andere Nachricht",
          sentAt: SENT_AT,
        },
      ),
    ).resolves.toBeNull();
  });
});
