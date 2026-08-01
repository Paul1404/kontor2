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

const organization = {
  displayName: "SV Beispiel",
  legalName: "Sportverein Beispiel 1945 e. V.",
  addressLines: ["Vereinsstraße 1", "97440 Beispielstadt"],
  contactEmail: "mitgliedschaft@sv-beispiel.test",
  contactPhone: "+49 9726 1234",
  brandColor: "#b51f2e",
  logoDataUri:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
};

describe("bank details confirmation email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a member-facing confirmation with masked account data", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organization,
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
    expect(content.body).toContain("SV Beispiel\nAutomatische Bestätigung");
    expect(content.body).toContain("Sportverein Beispiel 1945 e. V.");
    expect(content.body).toContain("Vereinsstraße 1\n97440 Beispielstadt");
    expect(content.body).toContain("E-Mail: mitgliedschaft@sv-beispiel.test");
    expect(content.body).toContain("Telefon: +49 9726 1234");
    expect(content.body).toContain("Technisch versendet über Kontor².");
    expect(content.body).toContain("•••• 9890");
    expect(content.body).toContain("Künftige Beitragseinzüge verwenden die neue Bankverbindung.");
    expect(content.body).not.toContain("DE12500105170648489890");
    expect(content.html).toContain("Automatische Bestätigung");
    expect(content.html).toContain("IBAN endet auf •••• 9890");
    expect(content.html).toContain("#b51f2e");
    expect(content.html).toContain("Sportverein Beispiel 1945 e. V.");
    expect(content.html).toContain('src="cid:vereinslogo@kontor2"');
    expect(content.attachments).toEqual([
      expect.objectContaining({
        filename: "vereinslogo.png",
        contentType: "image/png",
        cid: "vereinslogo@kontor2",
        contentDisposition: "inline",
      }),
    ]);
  });

  it("explains when direct debit was suspended", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organization,
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
      organization,
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    await expect(sendBankDetailsConfirmation({} as DB, content)).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      to: content.to,
      subject: content.subject,
      text: content.body,
      html: content.html,
      attachments: content.attachments,
    });
  });

  it("escapes organization and member names in the branded HTML", () => {
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta <Beispiel>",
      organization: {
        ...organization,
        displayName: "SV & Partner",
        legalName: "SV <Partner> e. V.",
        addressLines: ["A&B <Straße> 1"],
        contactEmail: "verein+bank@example.test",
      },
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    expect(content.html).toContain("Berta &lt;Beispiel&gt;");
    expect(content.html).toContain("SV &amp; Partner");
    expect(content.html).toContain("SV &lt;Partner&gt; e. V.");
    expect(content.html).toContain("A&amp;B &lt;Straße&gt; 1");
    expect(content.html).not.toContain("Berta <Beispiel>");
  });

  it("reports SMTP setup failures without throwing after the bank update", async () => {
    getMailer.mockRejectedValue(new Error("SMTP lookup failed"));
    const content = buildBankDetailsConfirmation({
      to: "berta@example.test",
      memberName: "Berta Beispiel",
      organization,
      newIbanLast4: "9890",
      debitSuspended: false,
    });

    await expect(sendBankDetailsConfirmation({} as DB, content)).resolves.toEqual({
      ok: false,
      reason: "SMTP lookup failed",
    });
  });
});
