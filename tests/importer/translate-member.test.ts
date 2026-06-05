import { describe, expect, it } from "vitest";
import { cleanMemberColumns, translateLinearMember } from "~/server/importer/translate-member";

describe("translateLinearMember", () => {
  it("returns null when AdrNr is missing", () => {
    expect(translateLinearMember({})).toBeNull();
  });

  it("translates a Linear adresse row to the clean shape", () => {
    const m = translateLinearMember({
      AdrNr: 42,
      MITGLNR: "M-0042",
      Vorname: "Anna",
      Nachname: "Beispiel",
      Strasse: "Hauptstr.",
      Hausnummer: "12a",
      PLZ: "97520",
      Ort: "Untereuerheim",
      Land: "DE",
      EMailName: "anna@example.com",
      Geburtsdatum: "1990-05-12 00:00:00.000000",
      Eintritt: "2010-01-01 00:00:00",
      Geloscht: false,
      AktivPasiv: "A",
      Abteilung: "Fußball, Tennis",
      IBAN1: "DE89370400440532013000",
      BIC1: "COBADEFFXXX",
      mandatsrefenz: "MAN-001",
    });
    expect(m).not.toBeNull();
    if (!m) return;
    expect(m.adrNr).toBe(42);
    expect(m.mitgliedsnummer).toBe("M-0042");
    expect(m.email).toBe("anna@example.com");
    expect(m.eintritt).toBeInstanceOf(Date);
    expect(m.status).toBe("aktiv");
    expect(m.isDeleted).toBe(false);
    expect(m.dunningBlocked).toBe(false);
    expect(m.iban1).toBe("DE89370400440532013000");
    expect(m.iban1Last4).toBe("3000");
    expect(m.mandatsreferenz).toBe("MAN-001");
  });

  it("normalizes legacy flags: geloscht, mahnSperre, status", () => {
    const exited = translateLinearMember({ AdrNr: 1, Austritt: "2024-01-01 00:00:00" });
    expect(exited?.status).toBe("ausgetreten");

    const deceased = translateLinearMember({
      AdrNr: 2,
      Austritt: "2024-01-01 00:00:00",
      VerstorbenAm: "2024-02-01 00:00:00",
    });
    expect(deceased?.status).toBe("verstorben");

    const passiv = translateLinearMember({ AdrNr: 3, AktivPasiv: "P" });
    expect(passiv?.status).toBe("passiv");

    const blocked = translateLinearMember({ AdrNr: 4, MahnSperre: "gesperrt" });
    expect(blocked?.dunningBlocked).toBe(true);
    expect(translateLinearMember({ AdrNr: 5, MahnSperre: "0" })?.dunningBlocked).toBe(false);

    const deleted = translateLinearMember({ AdrNr: 6, Geloscht: true });
    expect(deleted?.isDeleted).toBe(true);
  });

  it("falls back to Telefon3 for email when EMailName is missing", () => {
    expect(translateLinearMember({ AdrNr: 1, Telefon3: "old@example.com" })?.email).toBe(
      "old@example.com",
    );
  });

  it("zero-dates become null", () => {
    expect(
      translateLinearMember({ AdrNr: 1, Eintritt: "0000-00-00 00:00:00" })?.eintritt,
    ).toBeNull();
  });
});

describe("cleanMemberColumns", () => {
  it("projects exactly the four clean columns the importer dual-writes", () => {
    const clean = translateLinearMember({
      AdrNr: 7,
      MITGLNR: "M-0007",
      EMailName: "x@y.de",
      AktivPasiv: "P",
      MahnSperre: "gesperrt",
    });
    expect(clean).not.toBeNull();
    if (!clean) return;
    expect(cleanMemberColumns(clean)).toEqual({
      mitgliedsnummer: "M-0007",
      email: "x@y.de",
      status: "passiv",
      dunningBlocked: true,
    });
  });

  it("carries the normalized status and the email fallback through", () => {
    const clean = translateLinearMember({
      AdrNr: 8,
      Telefon3: "old@example.com",
      Austritt: "2024-01-01 00:00:00",
    });
    expect(clean).not.toBeNull();
    if (!clean) return;
    expect(cleanMemberColumns(clean)).toEqual({
      mitgliedsnummer: null,
      email: "old@example.com",
      status: "ausgetreten",
      dunningBlocked: false,
    });
  });
});
