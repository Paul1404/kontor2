import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "~/server/db/client";

const { getMailer, send } = vi.hoisted(() => ({
  getMailer: vi.fn(),
  send: vi.fn(),
}));

vi.mock("~/server/auth/send-invite", () => ({ getMailer }));

import {
  buildBankDetailsConfirmation,
  sendBankDetailsConfirmation,
} from "~/server/mail/send-bank-details-confirmation";

describe("bank details confirmation email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a member-facing confirmation with masked account data", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organizationName: "SV Beispiel",
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    expect(content).toEqual(
      expect.objectContaining({
        to: "berta@example.test",
        subject: "SV Beispiel: Bankverbindung geändert",
      }),
    );
    expect(content.body).toContain("Guten Tag Berta Beispiel,");
    expect(content.body).toContain("Kontor² · Automatische Bestätigung");
    expect(content.body).toContain(
      "Diese Nachricht wurde automatisch mit Kontor² im Auftrag von SV Beispiel erstellt.",
    );
    expect(content.body).toContain("•••• 9890");
    expect(content.body).toContain("Künftige Beitragseinzüge verwenden die neue Bankverbindung.");
    expect(content.body).not.toContain("DE12500105170648489890");
    expect(content.html).toContain("Automatische Bestätigung");
    expect(content.html).toContain("IBAN endet auf •••• 9890");
    expect(content.html).toContain("#14223d");
  });

  it("explains when direct debit was suspended", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organizationName: "SV Beispiel",
      newIbanLast4: "9890",
      debitSuspended: true,
    });

    expect(content.body).toContain("Der SEPA-Einzug ist vorerst ausgesetzt.");
    expect(content.body).not.toContain(
      "Künftige Beitragseinzüge verwenden die neue Bankverbindung.",
    );
  });

  it("dispatches the exact preview content through tenant SMTP", async () => {
    getMailer.mockResolvedValue({ send, from: "verein@example.test" });
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organizationName: "SV Beispiel",
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    await expect(sendBankDetailsConfirmation({} as DB, content)).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      to: content.to,
      subject: content.subject,
      text: content.body,
      html: content.html,
    });
  });

  it("escapes organization and member names in the branded HTML", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta <Beispiel>",
      organizationName: "SV & Partner",
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    expect(content.html).toContain("Berta &lt;Beispiel&gt;");
    expect(content.html).toContain("SV &amp; Partner");
    expect(content.html).not.toContain("Berta <Beispiel>");
  });

  it("reports SMTP setup failures without throwing after the bank update", async () => {
    getMailer.mockRejectedValue(new Error("SMTP lookup failed"));
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organizationName: "SV Beispiel",
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    await expect(sendBankDetailsConfirmation({} as DB, content)).resolves.toEqual({
      ok: false,
      reason: "SMTP lookup failed",
    });
  });
});
