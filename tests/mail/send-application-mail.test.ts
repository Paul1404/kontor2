import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/server/db/client";

const { sendBrandedMail } = vi.hoisted(() => ({ sendBrandedMail: vi.fn() }));

vi.mock("~/server/auth/send-invite", () => ({ sendBrandedMail }));

import { sendApplicationDocumentMail } from "~/server/mail/send-application-mail";

describe("sendApplicationDocumentMail", () => {
  beforeEach(() => sendBrandedMail.mockReset());

  it("returns the exact rendered alternatives and message id for archival", async () => {
    sendBrandedMail.mockResolvedValue({
      ok: true,
      subject: "Willkommen",
      bodyText: "Vollständiger Text",
      bodyHtml: "<html>Vollständiges Design</html>",
      messageId: "message-123",
    });

    const result = await sendApplicationDocumentMail({} as DB, {
      to: "mitglied@example.test",
      subject: "Willkommen",
      text: "Inhalt",
    });

    expect(result).toEqual({
      status: "sent",
      detail: null,
      bodyText: "Vollständiger Text",
      bodyHtml: "<html>Vollständiges Design</html>",
      messageId: "message-123",
    });
  });

  it("keeps both rendered alternatives when delivery fails", async () => {
    sendBrandedMail.mockResolvedValue({
      ok: false,
      reason: "smtp unavailable",
      subject: "Willkommen",
      bodyText: "Vollständiger Text",
      bodyHtml: "<html>Vollständiges Design</html>",
      messageId: null,
    });

    const result = await sendApplicationDocumentMail({} as DB, {
      to: "mitglied@example.test",
      subject: "Willkommen",
      text: "Inhalt",
    });

    expect(result).toMatchObject({
      status: "failed",
      detail: "smtp unavailable",
      bodyText: "Vollständiger Text",
      bodyHtml: "<html>Vollständiges Design</html>",
      messageId: null,
    });
  });
});
