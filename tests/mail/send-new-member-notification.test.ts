import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/server/db/client";

const { sendBrandedMail, recordEmail } = vi.hoisted(() => ({
  sendBrandedMail: vi.fn(),
  recordEmail: vi.fn(),
}));

vi.mock("~/server/auth/send-invite", () => ({ sendBrandedMail }));
vi.mock("~/server/mail/email-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/mail/email-log")>();
  return { ...actual, recordEmail };
});

import {
  newMemberBlocks,
  newMemberSubject,
  notifyVorstandNewMember,
  resolveNewMemberRecipient,
} from "~/server/mail/send-new-member-notification";

type OrgRow = {
  neumitgliedBenachrichtigungAktiv: boolean;
  neumitgliedVorstandEmail: string | null;
  antragVorstandEmail: string | null;
  mitgliedschaftEmail: string | null;
  kontaktEmail: string | null;
};

const ORG: OrgRow = {
  neumitgliedBenachrichtigungAktiv: true,
  neumitgliedVorstandEmail: "vorstand@verein.test",
  antragVorstandEmail: null,
  mitgliedschaftEmail: null,
  kontaktEmail: null,
};

/** Minimal stand-in for the Drizzle select chain the notifier uses. */
function dbWith(row: OrgRow | undefined): DB {
  return {
    select: () => ({ from: () => ({ limit: async () => (row ? [row] : []) }) }),
  } as unknown as DB;
}

describe("resolveNewMemberRecipient", () => {
  it("prefers the dedicated address", () => {
    expect(
      resolveNewMemberRecipient({
        neumitgliedVorstandEmail: "neu@verein.test",
        antragVorstandEmail: "antrag@verein.test",
        mitgliedschaftEmail: "mitglied@verein.test",
        kontaktEmail: "info@verein.test",
      }),
    ).toBe("neu@verein.test");
  });

  it("falls back through Antrag, Mitgliedschaft and Kontakt", () => {
    expect(
      resolveNewMemberRecipient({
        neumitgliedVorstandEmail: "   ",
        antragVorstandEmail: null,
        mitgliedschaftEmail: "mitglied@verein.test",
        kontaktEmail: "info@verein.test",
      }),
    ).toBe("mitglied@verein.test");
  });

  it("returns null when nothing is configured", () => {
    expect(
      resolveNewMemberRecipient({
        neumitgliedVorstandEmail: null,
        antragVorstandEmail: "",
        mitgliedschaftEmail: null,
        kontaktEmail: null,
      }),
    ).toBeNull();
  });
});

describe("newMemberSubject", () => {
  it("names the single new member and the reference", () => {
    expect(newMemberSubject([{ name: "Berta Beispiel", reference: "M-1234" }])).toBe(
      "Neues Mitglied: Berta Beispiel (M-1234)",
    );
  });

  it("counts the additional members of a family", () => {
    expect(
      newMemberSubject([
        { name: "Berta Beispiel", reference: "M-1234" },
        { name: "Bert Beispiel", reference: "M-1235" },
        { name: "Kim Beispiel", reference: "M-1236" },
      ]),
    ).toBe("Neue Mitglieder: Berta Beispiel und 2 weitere (M-1234)");
  });
});

describe("newMemberBlocks", () => {
  it("lists every member, the references and the origin", () => {
    const blocks = newMemberBlocks({
      memberId: "11111111-1111-4111-8111-111111111111",
      members: [
        { name: "Berta Beispiel", reference: "M-1234" },
        { name: "Kim Beispiel", reference: "M-1235" },
      ],
      origin: "antrag",
      eintritt: "2026-09-13",
      ort: "Untereuerheim",
      email: "berta@example.test",
      beitrag: "54.00000000",
      antragsnummer: "ANT-2026-0007",
      actorEmail: "buero@verein.test",
    });

    const callout = blocks.find((b) => b.kind === "callout");
    expect(callout).toEqual({
      kind: "callout",
      label: "Mitgliedsnummern",
      value: "M-1234, M-1235",
    });

    const bullets = blocks.filter((b) => b.kind === "bullets");
    expect(bullets[0]?.items).toEqual(["Berta Beispiel (M-1234)", "Kim Beispiel (M-1235)"]);
    expect(bullets[1]?.items).toEqual([
      "Eintritt: 13.09.2026",
      "Ort: Untereuerheim",
      "E-Mail: berta@example.test",
      // Intl setzt ein geschütztes Leerzeichen vor das Währungszeichen.
      "Jahresbeitrag: 54,00\u00a0€",
      "Antragsnummer: ANT-2026-0007",
      "Herkunft: Genehmigter Aufnahmeantrag",
      "Erfasst von: buero@verein.test",
    ]);
  });

  it("omits details that were not supplied", () => {
    const blocks = newMemberBlocks({
      memberId: "11111111-1111-4111-8111-111111111111",
      members: [{ name: "Berta Beispiel", reference: "M-1234" }],
      origin: "manuell",
    });
    const bullets = blocks.filter((b) => b.kind === "bullets");
    expect(bullets[1]?.items).toEqual(["Herkunft: Manuelle Neuanlage in der Vereinsverwaltung"]);
  });
});

describe("notifyVorstandNewMember", () => {
  beforeEach(() => {
    sendBrandedMail.mockReset();
    recordEmail.mockReset();
    sendBrandedMail.mockResolvedValue({
      ok: true,
      bodyText: "Text",
      bodyHtml: "<html>Design</html>",
      messageId: "message-1",
    });
  });

  const params = {
    memberId: "11111111-1111-4111-8111-111111111111",
    members: [{ name: "Berta Beispiel", reference: "M-1234" }],
    origin: "manuell" as const,
  };

  it("sends to the configured address and logs the send", async () => {
    await notifyVorstandNewMember(dbWith(ORG), params);

    expect(sendBrandedMail).toHaveBeenCalledTimes(1);
    const call = sendBrandedMail.mock.calls[0]![1];
    expect(call.to).toBe("vorstand@verein.test");
    // A club-internal notice must not greet or sign off to itself.
    expect(call.document.greeting).toBeNull();
    expect(call.document.closing).toBeNull();
    expect(recordEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "new_member_notification",
        status: "sent",
        recipient: "vorstand@verein.test",
        entityType: "member",
        entityId: params.memberId,
        messageId: "message-1",
      }),
      expect.anything(),
    );
  });

  it("stays silent when the notification is switched off", async () => {
    await notifyVorstandNewMember(
      dbWith({ ...ORG, neumitgliedBenachrichtigungAktiv: false }),
      params,
    );
    expect(sendBrandedMail).not.toHaveBeenCalled();
    expect(recordEmail).not.toHaveBeenCalled();
  });

  it("logs a skipped entry when no recipient is configured", async () => {
    await notifyVorstandNewMember(dbWith({ ...ORG, neumitgliedVorstandEmail: null }), params);
    expect(sendBrandedMail).not.toHaveBeenCalled();
    expect(recordEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped", detail: "no_recipient" }),
      expect.anything(),
    );
  });

  it("records a failed send without throwing", async () => {
    sendBrandedMail.mockResolvedValue({
      ok: false,
      reason: "connection refused",
      bodyText: "Text",
      bodyHtml: "<html>Design</html>",
      messageId: null,
    });
    await expect(notifyVorstandNewMember(dbWith(ORG), params)).resolves.toBeUndefined();
    expect(recordEmail).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", detail: "connection refused" }),
      expect.anything(),
    );
  });

  it("swallows a database failure so an onboarding is never lost", async () => {
    const broken = {
      select: () => ({
        from: () => ({
          limit: async () => {
            throw new Error("db down");
          },
        }),
      }),
    } as unknown as DB;
    await expect(notifyVorstandNewMember(broken, params)).resolves.toBeUndefined();
    expect(sendBrandedMail).not.toHaveBeenCalled();
  });
});
