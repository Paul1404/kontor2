import { describe, expect, it } from "vitest";
import {
  buildKulanzClubModel,
  buildKulanzLetterModel,
  fmtKulanzDate,
  fmtKulanzIban,
  fmtKulanzMoney,
  kulanzSalutation,
} from "~/server/pdf/kulanz-model";

const baseLetter = {
  recipient: {
    anrede: "Herr" as string | null,
    name: "Max Mustermann",
    strasse: "Hauptstr.",
    hausnummer: "1",
    plz: "97447",
    ort: "Untereuerheim",
    vertretungFor: null as string | null,
  },
  member: { mitgliedsnummer: "123", name: "Max Mustermann" },
  postings: [
    {
      billingYear: 2024,
      falligkeitsdatum: "2024-03-01",
      description: "Beitrag (Aktiv)",
      openAmount: "30.00",
    },
    {
      billingYear: 2025,
      falligkeitsdatum: "2025-03-01",
      description: "Beitrag (Aktiv)",
      openAmount: "30.00",
    },
  ],
  openSum: "60.00",
  runDate: "2026-06-04",
  deadlineDate: "2026-06-18",
  vereinsname: "SV Untereuerheim",
};

describe("formatters", () => {
  it("formats ISO dates as German", () => {
    expect(fmtKulanzDate("2026-06-04")).toBe("04.06.2026");
    expect(fmtKulanzDate("nicht-iso")).toBe("nicht-iso");
    expect(fmtKulanzDate("")).toBe("");
  });

  it("formats money in German with two decimals", () => {
    expect(fmtKulanzMoney("60")).toBe("60,00");
    expect(fmtKulanzMoney("1234.5")).toBe("1.234,50");
  });

  it("groups IBANs into blocks of four", () => {
    expect(fmtKulanzIban("de89370400440532013000")).toBe("DE89 3704 0044 0532 0130 00");
  });
});

describe("kulanzSalutation", () => {
  it("resolves Herr and Frau from free-text Anrede, using the last name word", () => {
    expect(kulanzSalutation("Herr", "Max Mustermann")).toBe("Sehr geehrter Herr Mustermann,");
    expect(kulanzSalutation("Frau Dr.", "Erika Musterfrau")).toBe("Sehr geehrte Frau Musterfrau,");
  });

  it("falls back to a neutral salutation when the Anrede is unknown", () => {
    expect(kulanzSalutation(null, "Verein XY")).toBe("Sehr geehrte Damen und Herren,");
  });
});

describe("buildKulanzClubModel", () => {
  it("builds a sender line and formats the IBAN", () => {
    const club = buildKulanzClubModel({
      vereinsname: "SV Untereuerheim",
      anschriftStrasse: "Sportplatz 1",
      anschriftPlz: "97447",
      anschriftOrt: "Untereuerheim",
      vereinsIban: "DE89370400440532013000",
      vereinsBic: "COBADEFFXXX",
      vereinsBankname: "Sparkasse",
      glaeubigerId: "DE00ZZZ00000000000",
      logoDataUri: null,
    });
    expect(club.senderLine).toBe("SV Untereuerheim · Sportplatz 1 · 97447 Untereuerheim");
    expect(club.bank.iban).toBe("DE89 3704 0044 0532 0130 00");
    expect(club.bank.empfaenger).toBe("SV Untereuerheim");
  });
});

describe("buildKulanzLetterModel", () => {
  it("mentions the deadline in both the payment and the Kulanz paragraph", () => {
    const m = buildKulanzLetterModel(baseLetter);
    expect(m.intro).toContain("18.06.2026");
    expect(m.kulanz).toContain("Sonderkündigung");
    expect(m.kulanz).toContain("18.06.2026");
    expect(m.kulanz).toContain("verzichten wir auf die offene Forderung");
  });

  it("renders postings rows and the total with a Euro sign", () => {
    const m = buildKulanzLetterModel(baseLetter);
    expect(m.postings).toHaveLength(2);
    expect(m.postings[0]).toEqual({
      jahrFaellig: "2024 · 01.03.2024",
      bezeichnung: "Beitrag (Aktiv)",
      offen: "30,00 €",
    });
    expect(m.openSum).toBe("60,00 €");
  });

  it("builds the tear-off slip with member identity and club name", () => {
    const m = buildKulanzLetterModel(baseLetter);
    expect(m.slip.intro).toBe("Hiermit kündige ich meine Mitgliedschaft beim SV Untereuerheim.");
    expect(m.slip.memberLine).toBe("Max Mustermann · Mitgliedsnummer 123");
  });

  it("drops empty address lines and surfaces the guardian note", () => {
    const m = buildKulanzLetterModel({
      ...baseLetter,
      recipient: {
        anrede: "Frau",
        name: "Erika Musterfrau",
        strasse: null,
        hausnummer: null,
        plz: null,
        ort: null,
        vertretungFor: "Max Mustermann",
      },
    });
    expect(m.recipientLines).toEqual(["Erika Musterfrau"]);
    expect(m.vertretungFor).toBe("Max Mustermann");
    expect(m.salutation).toBe("Sehr geehrte Frau Musterfrau,");
  });
});
