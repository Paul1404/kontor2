import { describe, expect, it } from "vitest";
import { type BeitrittClub, buildBeitrittModel } from "~/server/pdf/beitrittserklaerung-model";

const club: BeitrittClub = {
  vereinsname: "SV Untereuerheim",
  ort: "Untereuerheim",
  anschriftStrasse: "Triebweg 9",
  anschriftPlz: "97508",
  anschriftOrt: "Grettstadt",
  kontaktEmail: "info@verein.de",
  kontaktTelefon: null,
  glaeubigerId: "DE71ZZZ00000901082",
  datenschutzUrl: null,
  satzungUrl: null,
  logoDataUri: null,
};

const base = {
  antragsnummer: "ANT-2026-0001",
  geburtsdatum: "1990-05-20",
  strasse: "Hauptstr. 1",
  plz: "97000",
  ort: "Musterstadt",
  telefon: null,
  email: "a@b.de",
  abteilungen: ["Fußball"],
  mitgliedschaftLabel: "Erwachsene",
  jahresbeitrag: "54.00",
  kontoinhaber: "Max Mustermann",
  ibanFormatted: "DE12 3456 7890 1234 5678 90",
  bic: "BYLADEM1KSW",
  kreditinstitut: "Sparkasse",
  mandatsreferenz: "SVU-2026-0001",
  consentAt: new Date("2026-01-10T10:00:00Z"),
  club,
};

describe("buildBeitrittModel", () => {
  it("uses a gendered salutation for Herr", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "einzel",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
    });
    expect(m.anrede).toBe("Sehr geehrter Herr Mustermann,");
  });

  it("falls back to a neutral greeting without a gender", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "einzel",
      geschlecht: null,
      vorname: "Alex",
      nachname: "Muster",
    });
    expect(m.anrede).toBe("Guten Tag Alex Muster,");
  });

  it("addresses the guardian on a Kind application", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "kind",
      geschlecht: "w",
      vorname: "Kind",
      nachname: "Klein",
      erziehungsberechtigterVorname: "Erika",
      erziehungsberechtigterNachname: "Klein",
    });
    expect(m.unterschriftName).toBe("Erika Klein");
    expect(m.guardianRows.length).toBeGreaterThan(0);
  });

  it("lists partner and children on a Familie application", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "familie",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
      partnerVorname: "Erika",
      partnerNachname: "Mustermann",
      partnerGeburtsdatum: "1992-02-02",
      kinder: [
        {
          vorname: "Kind",
          nachname: "Mustermann",
          geburtsdatum: "2015-01-01",
          abteilungen: ["Turnen"],
        },
      ],
    });
    expect(m.partnerRows.length).toBeGreaterThan(0);
    expect(m.kinder).toHaveLength(1);
    expect(m.kinder[0]?.geburtsdatum).toBe("01.01.2015");
  });

  it("records the consent date in the consent text", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "einzel",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
    });
    expect(m.consentText).toContain("10.01.2026");
  });

  it("leaves countersignature and approval empty by default", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "einzel",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
    });
    expect(m.countersignatureDataUri).toBeNull();
    expect(m.countersignerName).toBeNull();
    expect(m.approvedAt).toBe("");
  });

  it("carries the Vorstand countersignature and approval date when approved", () => {
    const m = buildBeitrittModel({
      ...base,
      antragstyp: "einzel",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
      countersignatureDataUri: "data:image/png;base64,AAA",
      countersignerName: "  Erika Vorstand, 1. Vorsitzende  ",
      approvedAt: new Date("2026-02-15T09:00:00Z"),
    });
    expect(m.countersignatureDataUri).toBe("data:image/png;base64,AAA");
    expect(m.countersignerName).toBe("Erika Vorstand, 1. Vorsitzende");
    expect(m.approvedAt).toBe("15.02.2026");
  });
});
