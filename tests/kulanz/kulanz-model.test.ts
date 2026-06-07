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
  member: { reference: "123", isContact: false, name: "Max Mustermann" },
  postings: [
    {
      billingYear: 2024,
      falligkeitsdatum: "2024-03-01",
      description: "Beitrag (Aktiv)",
      openAmount: "30.00",
      rueckgebuhr: "0.00",
    },
    {
      billingYear: 2025,
      falligkeitsdatum: "2025-03-01",
      description: "Beitrag (Aktiv)",
      openAmount: "30.00",
      rueckgebuhr: "0.00",
    },
  ],
  openSum: "60.00",
  runDate: "2026-06-04",
  deadlineDate: "2026-06-18",
  vereinsname: "SV Untereuerheim",
  kontaktEmail: "mitgliedschaft@sv-untereuerheim.de" as string | null,
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
  const clubInput = {
    vereinsname: "SV Untereuerheim",
    anschriftStrasse: "Sportplatz 1",
    anschriftPlz: "97447",
    anschriftOrt: "Untereuerheim",
    kontaktEmail: "mitgliedschaft@sv-untereuerheim.de",
    vereinsIban: "DE89370400440532013000",
    vereinsBic: "COBADEFFXXX",
    vereinsBankname: "Sparkasse",
    glaeubigerId: "DE00ZZZ00000000000",
    logoDataUri: null,
  };

  it("builds a sender line and formats the IBAN", () => {
    const club = buildKulanzClubModel(clubInput);
    expect(club.senderLine).toBe("SV Untereuerheim · Sportplatz 1 · 97447 Untereuerheim");
    expect(club.bank.iban).toBe("DE89 3704 0044 0532 0130 00");
    expect(club.bank.empfaenger).toBe("SV Untereuerheim");
  });

  it("builds a return address and email so the tear-off slip has a destination", () => {
    const club = buildKulanzClubModel(clubInput);
    expect(club.rueckantwort.adresseLines).toEqual([
      "SV Untereuerheim",
      "Sportplatz 1",
      "97447 Untereuerheim",
    ]);
    expect(club.rueckantwort.email).toBe("mitgliedschaft@sv-untereuerheim.de");
  });

  it("omits the email line when no contact mailbox is configured", () => {
    const club = buildKulanzClubModel({ ...clubInput, kontaktEmail: null });
    expect(club.rueckantwort.email).toBeNull();
    expect(club.rueckantwort.adresseLines).toContain("SV Untereuerheim");
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

  it("offers a formless cancellation by email when a contact mailbox is configured", () => {
    const m = buildKulanzLetterModel(baseLetter);
    expect(m.kulanzEmail).toContain("mitgliedschaft@sv-untereuerheim.de");
    expect(m.kulanzEmail).toContain("formlos");
    expect(m.kulanzEmail).toContain("18.06.2026");
  });

  it("omits the email option when no contact mailbox is configured", () => {
    const m = buildKulanzLetterModel({ ...baseLetter, kontaktEmail: null });
    expect(m.kulanzEmail).toBeNull();
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
    expect(m.rueckgebuhr).toBeNull();
    expect(m.rueckgebuhrErlass).toBeNull();
    expect(m.feeWaiverNote).toBeNull();
  });

  it("surfaces SEPA return fees as a separate line so the rows reconcile with the total", () => {
    // 30,00 Beitrag + 3,00 R-Gebühr on the first posting, 30,00 on the second:
    // openSum upstream already folds the fee in (63,00). The fee must show as
    // its own line so the visible rows add up to the printed total.
    const m = buildKulanzLetterModel({
      ...baseLetter,
      postings: [
        { ...baseLetter.postings[0]!, rueckgebuhr: "3.00" },
        { ...baseLetter.postings[1]!, rueckgebuhr: "0.00" },
      ],
      openSum: "63.00",
    });
    expect(m.postings.map((p) => p.offen)).toEqual(["30,00 €", "30,00 €"]);
    expect(m.rueckgebuhr).toBe("3,00 €");
    expect(m.rueckgebuhrErlass).toBeNull();
    // 30,00 + 30,00 + 3,00 fee = 63,00 total shown.
    expect(m.openSum).toBe("63,00 €");
  });

  it("waives the SEPA return fee out of goodwill: adds it then subtracts it so the total nets to the Beitrag", () => {
    const m = buildKulanzLetterModel({
      ...baseLetter,
      postings: [
        { ...baseLetter.postings[0]!, rueckgebuhr: "3.00" },
        { ...baseLetter.postings[1]!, rueckgebuhr: "0.00" },
      ],
      openSum: "63.00",
      waiveReturnFee: true,
    });
    // The fee shows as a positive line, then the Erlass subtracts it again, so
    // the visible rows reconcile to the bare Beitrag.
    expect(m.rueckgebuhr).toBe("3,00 €");
    expect(m.rueckgebuhrErlass).toBe("-3,00 €");
    expect(m.feeWaiverNote).toContain("3,00 €");
    expect(m.feeWaiverNote).toContain("erlassen");
    // Only the Beitrag remains payable: 30,00 + 30,00 + 3,00 - 3,00 = 60,00.
    expect(m.openSum).toBe("60,00 €");
  });

  it("ignores the waive flag when there is no SEPA return fee", () => {
    const m = buildKulanzLetterModel({ ...baseLetter, waiveReturnFee: true });
    expect(m.rueckgebuhr).toBeNull();
    expect(m.rueckgebuhrErlass).toBeNull();
    expect(m.feeWaiverNote).toBeNull();
    expect(m.openSum).toBe("60,00 €");
  });

  it("builds the tear-off slip with member identity and club name", () => {
    const m = buildKulanzLetterModel(baseLetter);
    expect(m.slip.intro).toBe("Hiermit kündige ich meine Mitgliedschaft beim SV Untereuerheim.");
    expect(m.slip.memberLine).toBe("Max Mustermann · Mitgliedsnummer 123");
    expect(m.referenceLabel).toBe("Mitgliedsnummer");
    expect(m.reference).toBe("123");
  });

  it("uses a neutral reference label for contact-only payers without a Mitgliedsnummer", () => {
    const m = buildKulanzLetterModel({
      ...baseLetter,
      member: { reference: "A4711", isContact: true, name: "Max Mustermann" },
    });
    expect(m.referenceLabel).toBe("Referenz");
    expect(m.reference).toBe("A4711");
    expect(m.slip.memberLine).toBe("Max Mustermann · Referenz A4711");
    expect(m.verwendungszweck).toContain("Referenz A4711");
    expect(m.kulanzEmail).toContain("Ihre Referenz");
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
