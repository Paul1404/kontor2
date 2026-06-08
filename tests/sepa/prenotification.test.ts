import { describe, expect, it } from "vitest";
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
    const { text } = buildPrenotificationEmail({ ...base, glaeubigerId: null });
    expect(text).not.toContain("Gläubiger-Identifikationsnummer");
  });
});
