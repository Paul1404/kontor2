import { describe, expect, it } from "vitest";
import { renderMail } from "~/server/mail/layout";
import { buildPrenotificationEmail } from "~/server/sepa/prenotification";

describe("buildPrenotificationEmail", () => {
  const base = {
    recipientName: "Max Mustermann",
    vereinsname: "SV Untereuerheim",
    glaeubigerId: "DE98ZZZ09999999999",
    mandateRef: "MND-0001",
    amount: "42.50",
    falligkeitsdatum: "2026-07-01",
    billingYear: 2026,
  };

  it("formats amount and date in German and includes the key SEPA fields", () => {
    const { subject, text } = buildPrenotificationEmail(base);
    expect(subject).toContain("2026");
    expect(text).toContain("Max Mustermann");
    expect(text).toContain("42,50 €");
    expect(text).toContain("01.07.2026");
    expect(text).toContain("MND-0001");
    expect(text).toContain("DE98ZZZ09999999999");
    expect(text).toContain("SV Untereuerheim");
  });

  it("omits the Gläubiger-ID line when it is missing", () => {
    const { document, text } = buildPrenotificationEmail({ ...base, glaeubigerId: null });
    expect(text).not.toContain("Gläubiger-Identifikationsnummer");
    expect(document.blocks).not.toContainEqual(
      expect.objectContaining({ label: "Gläubiger-Identifikationsnummer" }),
    );
  });

  it("renders the shared branded HTML and matching text alternative", () => {
    const { document } = buildPrenotificationEmail(base);
    const rendered = renderMail({
      ...document,
      organization: {
        displayName: "SV Untereuerheim",
        legalName: "Sportverein 1945 Untereuerheim e.V.",
        addressLines: ["Musterweg 1", "97508 Untereuerheim"],
        contactEmail: "verein@example.test",
        contactPhone: null,
        brandColor: "#a6864e",
        logoDataUri: null,
      },
    });
    expect(rendered.html).toContain("<!doctype html>");
    expect(rendered.html).toContain("SEPA-Lastschrift");
    expect(rendered.html).toContain("42,50 €");
    expect(rendered.text).toContain("Mandatsreferenz: MND-0001");
    expect(rendered.text).toContain("Technisch versendet über Kontor²");
  });
});
