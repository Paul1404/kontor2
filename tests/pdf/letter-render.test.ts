import { describe, expect, it } from "vitest";
import { buildCancellationModel } from "~/server/pdf/cancellation-model";
import { buildKulanzClubModel, buildKulanzLetterModel } from "~/server/pdf/kulanz-model";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AustrittsbestaetigungDocument } from "~/server/pdf/templates/austrittsbestaetigung";
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
            mitglnr: "1234",
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
      member: { mitgliedsnummer: "1234", name: "Erika Mustermann" },
      postings: [posting],
      openSum: "60.00",
      runDate: "2026-06-04",
      deadlineDate: "2026-06-18",
      vereinsname: org.vereinsname,
      kontaktEmail: "mitgliedschaft@untereuerheim.de",
    });
    await expectValidPdf(
      KulanzSonderkuendigungDocument({ club, letters: [letter], docRef: "KS-2026-0001" }),
    );
  });
});
