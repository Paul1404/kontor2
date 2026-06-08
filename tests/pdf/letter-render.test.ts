import { describe, expect, it } from "vitest";
import { buildCancellationModel } from "~/server/pdf/cancellation-model";
import { buildEhrungsurkundeModel } from "~/server/pdf/ehrungsurkunde-model";
import { buildKulanzClubModel, buildKulanzLetterModel } from "~/server/pdf/kulanz-model";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AustrittsbestaetigungDocument } from "~/server/pdf/templates/austrittsbestaetigung";
import { EhrungsurkundeDocument } from "~/server/pdf/templates/ehrungsurkunde";
import { KulanzSonderkuendigungDocument } from "~/server/pdf/templates/kulanz-sonderkuendigung";
import { MahnungDocument } from "~/server/pdf/templates/mahnung";

/**
 * Smoke test for the DIN 5008 letter templates: they have no other coverage, so
 * a broken prop or layout reference would otherwise only surface at download
 * time. We assert each document renders to a real, non-trivial PDF buffer.
 */

const org = {
  vereinsname: "SV Untereuerheim 1947 e.V.",
  anschriftStrasse: "Sportplatzweg 3",
  anschriftPlz: "97516",
  anschriftOrt: "Untereuerheim",
  vereinsIban: "DE89370400440532013000",
  vereinsBic: "GENODEF1SW1",
  vereinsBankname: "VR-Bank Schweinfurt",
  glaeubigerId: "DE98ZZZ09999999999",
  logoDataUri: null,
};

const posting = {
  billingYear: 2025,
  falligkeitsdatum: "2025-01-15",
  description: "Beitrag 2025 (Erwachsene Aktiv)",
  openAmount: "60.00",
  // Used by the Mahnung document (MahnungPosting); the Kulanz model ignores it.
  rueckgebuhr: "0.00",
};

async function expectValidPdf(element: Parameters<typeof renderPdfBase64>[0]) {
  const { base64, byteSize } = await renderPdfBase64(element);
  const buf = Buffer.from(base64, "base64");
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(byteSize).toBeGreaterThan(1000);
}

describe("DIN 5008 letter templates", () => {
  it("renders the Mahnung", async () => {
    await expectValidPdf(
      MahnungDocument({
        docRef: "MA-2026-0042",
        pkg: {
          level: 2,
          runDate: "2026-06-04",
          dueDate: "2026-06-18",
          organization: org,
          member: {
            memberNo: "M-AB1234",
            kontaktNo: null,
            mitgliedsnummer: "1234",
            adrNr: 1234,
            vorname: "Erika",
            nachname: "Mustermann",
            kurzname: null,
            firma1: null,
          },
          recipient: {
            anrede: "Frau",
            name: "Erika Mustermann",
            strasse: "Hauptstraße",
            hausnummer: "12a",
            plz: "97516",
            ort: "Untereuerheim",
            vertretungFor: null,
          },
          postings: [posting],
          openSum: "60.00",
          mahngebuhr: "5.00",
          totalDue: "65.00",
        },
      }),
    );
  });

  it("renders the Austrittsbestätigung", async () => {
    const model = buildCancellationModel({
      member: {
        anrede: "Herr",
        vorname: "Max",
        nachname: "Mustermann",
        strasse: "Hauptstraße 12a",
        plz: "97516",
        ort: "Untereuerheim",
        geburtsdatum: "1980-03-01",
        mitgliedsnummer: "1234",
      },
      austrittDatum: "2026-12-31",
      abteilung: "Fußball",
      club: {
        vereinsname: org.vereinsname,
        ort: org.anschriftOrt,
        anschriftStrasse: org.anschriftStrasse,
        anschriftPlz: org.anschriftPlz,
        anschriftOrt: org.anschriftOrt,
        kontaktEmail: "mitgliedschaft@untereuerheim.de",
        kontaktTelefon: "09729 432",
        datenschutzUrl: "https://sv-untereuerheim.de/datenschutz",
        satzungUrl: null,
        logoDataUri: null,
      },
      today: new Date("2026-06-04"),
    });
    await expectValidPdf(AustrittsbestaetigungDocument({ model, docRef: "AU-2026-0042" }));
  });

  it("renders the Kulanz-Brief (cover plus response page)", async () => {
    const club = buildKulanzClubModel({
      vereinsname: org.vereinsname,
      anschriftStrasse: org.anschriftStrasse,
      anschriftPlz: org.anschriftPlz,
      anschriftOrt: org.anschriftOrt,
      kontaktEmail: "mitgliedschaft@untereuerheim.de",
      vereinsIban: org.vereinsIban,
      vereinsBic: org.vereinsBic,
      vereinsBankname: org.vereinsBankname,
      glaeubigerId: org.glaeubigerId,
      logoDataUri: null,
    });
    const letter = buildKulanzLetterModel({
      recipient: {
        anrede: "Frau",
        name: "Erika Mustermann",
        strasse: "Hauptstraße",
        hausnummer: "12a",
        plz: "97516",
        ort: "Untereuerheim",
        vertretungFor: null,
      },
      member: {
        reference: "1234",
        isContact: false,
        name: "Erika Mustermann",
        mitgliedsnummer: "98765",
      },
      postings: [posting],
      runDate: "2026-06-04",
      deadlineDate: "2026-06-18",
      vereinsname: org.vereinsname,
      kontaktEmail: "mitgliedschaft@untereuerheim.de",
    });
    // A second letter exercises the contact-only reference and the waived fee
    // branches so the template renders both paths.
    const contactLetter = buildKulanzLetterModel({
      recipient: {
        anrede: null,
        name: "Spedition Mustermann",
        strasse: "Industriestraße",
        hausnummer: "5",
        plz: "97516",
        ort: "Untereuerheim",
        vertretungFor: null,
      },
      member: {
        reference: "A4711",
        isContact: true,
        name: "Spedition Mustermann",
        mitgliedsnummer: null,
      },
      postings: [posting],
      runDate: "2026-06-04",
      deadlineDate: "2026-06-18",
      vereinsname: org.vereinsname,
      kontaktEmail: "mitgliedschaft@untereuerheim.de",
      sepaFee: "3.00",
      waiveReturnFee: true,
    });
    await expectValidPdf(
      KulanzSonderkuendigungDocument({
        club,
        letters: [letter, contactLetter],
        docRef: "KS-2026-0001",
      }),
    );
  });

  it("renders the Ehrungsurkunde for both honor kinds", async () => {
    const jubilaeum = buildEhrungsurkundeModel({
      vereinsname: org.vereinsname,
      ort: org.anschriftOrt,
      logoDataUri: null,
      empfaengerName: "Erika Mustermann",
      mitgliedsnummer: "98765",
      kind: "vereinsjubilaeum",
      jubilaeumJahre: 40,
      titel: "40 Jahre Mitgliedschaft",
      verliehenAm: "2025-03-15",
      docRef: "EU-2025-0007",
    });
    await expectValidPdf(EhrungsurkundeDocument({ model: jubilaeum }));

    const sonder = buildEhrungsurkundeModel({
      vereinsname: org.vereinsname,
      ort: null,
      logoDataUri: null,
      empfaengerName: "Max Mustermann",
      mitgliedsnummer: null,
      kind: "sonderehrung",
      jubilaeumJahre: null,
      titel: "Goldene Ehrennadel",
      verliehenAm: "2025-03-15",
      docRef: "EU-2025-0008",
    });
    await expectValidPdf(EhrungsurkundeDocument({ model: sonder }));
  });
});
