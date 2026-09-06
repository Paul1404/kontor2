import * as v from "valibot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { manualLetterOptionsSchema } from "~/lib/manual-letter";
import type { DB } from "~/server/db/client";
import { recordEmail } from "~/server/mail/email-log";
import { notifyByPost } from "~/server/mail/notify-by-post";
import { MitteilungDocument } from "~/server/pdf/templates/mitteilung";
import { deleteObject, putObject } from "~/server/s3/client";

vi.mock("~/server/db/doc-ref", () => ({ allocateDocRef: vi.fn(async () => "MT-2026-0001") }));
vi.mock("~/server/mail/email-log", () => ({ recordEmail: vi.fn(async () => undefined) }));
vi.mock("~/server/pdf/logo", () => ({ resolveClubLogo: () => null }));
vi.mock("~/server/pdf/templates/mitteilung", () => ({ MitteilungDocument: vi.fn(() => null) }));
vi.mock("~/server/pdf/renderer", () => ({ renderPdfBase64: async () => ({ base64: "JVBERi0=" }) }));
vi.mock("~/server/s3/client", () => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
}));

const db = {
  select: () => ({
    from: () => ({
      limit: async () => [
        {
          vereinsname: "Testverein",
          anschriftStrasse: "Vereinsweg 1",
          anschriftPlz: "12345",
          anschriftOrt: "Musterstadt",
        },
      ],
    }),
  }),
} as unknown as DB;
const input = {
  kind: "letter" as const,
  recipient: {
    memberId: "member-1",
    recipientLines: ["Erika Beispiel", "Testweg 2", "12345 Musterstadt"],
    reference: "M-123",
  },
  subject: "Ihre Mitgliedschaft",
  greeting: "Guten Tag,",
  blocks: [{ kind: "paragraph" as const, text: "Vielen Dank." }],
  bodyText: "Guten Tag,\n\nVielen Dank.",
};

beforeEach(() => vi.clearAllMocks());

function recordedLetter() {
  const entry = vi.mocked(recordEmail).mock.calls[0]![0];
  if (Array.isArray(entry)) throw new Error("Expected one letter");
  return entry;
}

describe("manual letter overrides", () => {
  it("preserves personal details in the PDF, stored file and printed history", async () => {
    await notifyByPost(db, {
      ...input,
      letterOptions: v.parse(manualLetterOptionsSchema, {
        senderName: " Paul Dresch ",
        senderTitle: "Mitgliederverwaltung",
        contact: "paul@example.org",
        returnAddress: "Paul Dresch · Musterweg 3 · 12345 Musterstadt",
        letterDate: "2026-09-01",
        signatureSpace: true,
      }),
      enclosures: ["Beitragsübersicht"],
    });
    expect(MitteilungDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        club: expect.objectContaining({
          vereinsname: "Testverein",
          senderLine: "Paul Dresch · Musterweg 3 · 12345 Musterstadt",
        }),
        model: expect.objectContaining({
          datum: "01.09.2026",
          signatureLines: ["Paul Dresch", "Mitgliederverwaltung", "paul@example.org"],
          signatureSpace: true,
        }),
      }),
    );
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "application/pdf", body: expect.any(Buffer) }),
    );
    const log = recordedLetter();
    expect(log.status).toBe("printed");
    expect(log.bodyText).toContain(
      "Freundliche Grüße\nPaul Dresch\nMitgliederverwaltung\npaul@example.org",
    );
    expect(log.bodyText).toContain("Briefdatum: 01.09.2026");
    expect(log.bodyText).toContain("Anlagen: Beitragsübersicht");
  });

  it("retains club defaults for existing automated callers", async () => {
    await notifyByPost(db, input);
    expect(MitteilungDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        club: expect.objectContaining({
          senderLine: "Testverein · Vereinsweg 1 · 12345 Musterstadt",
        }),
        model: expect.objectContaining({
          closing: "Freundliche Grüße",
          signatureLines: ["Testverein"],
        }),
      }),
    );
    expect(recordedLetter().bodyText).toBe(input.bodyText);
  });

  it("omits the personal closing from history when the operator clears it", async () => {
    await notifyByPost(db, {
      ...input,
      closing: null,
      letterOptions: v.parse(manualLetterOptionsSchema, { senderName: "Paul Dresch" }),
    });
    expect(recordedLetter().bodyText).not.toContain("Paul Dresch");
    expect(MitteilungDocument).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ closing: null }) }),
    );
  });

  it("removes the stored PDF if recording the letter fails", async () => {
    vi.mocked(recordEmail).mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(notifyByPost(db, input)).rejects.toThrow("Database unavailable");
    expect(deleteObject).toHaveBeenCalledWith(
      expect.stringContaining("members/member-1/letters/MT-2026-0001/"),
    );
  });

  it("rejects invalid dates, oversized fields and injected line breaks", () => {
    for (const value of [
      { letterDate: "tomorrow" },
      { letterDate: "2026-02-31" },
      { senderName: "x".repeat(101) },
      { returnAddress: "Name\nAnother line" },
    ]) {
      expect(v.safeParse(manualLetterOptionsSchema, value).success).toBe(false);
    }
    expect(v.parse(manualLetterOptionsSchema, {}).senderName).toBe("");
  });
});
