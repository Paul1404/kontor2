import { describe, expect, it } from "vitest";
import { type BeitrittClub, buildBeitrittModel } from "~/server/pdf/beitrittserklaerung-model";
import { buildCancellationModel } from "~/server/pdf/cancellation-model";
import { buildEhrungsurkundeModel } from "~/server/pdf/ehrungsurkunde-model";
import { buildKulanzClubModel, buildKulanzLetterModel } from "~/server/pdf/kulanz-model";
import { renderPdfBase64 } from "~/server/pdf/renderer";
import { AustrittsbestaetigungDocument } from "~/server/pdf/templates/austrittsbestaetigung";
import { BeitrittserklaerungDocument } from "~/server/pdf/templates/beitrittserklaerung";
import { EhrungsurkundeDocument } from "~/server/pdf/templates/ehrungsurkunde";
import { KulanzSonderkuendigungDocument } from "~/server/pdf/templates/kulanz-sonderkuendigung";
import { MahnungDocument } from "~/server/pdf/templates/mahnung";
import { MitteilungDocument } from "~/server/pdf/templates/mitteilung";

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

/** Count page objects in a rendered PDF (one `/Type /Page` per page). */
async function pdfPageCount(element: Parameters<typeof renderPdfBase64>[0]): Promise<number> {
  const { base64 } = await renderPdfBase64(element);
  const s = Buffer.from(base64, "base64").toString("latin1");
  return (s.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

// 1x1 PNG, stands in for a configured Vorstand signature image.
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

describe("DIN 5008 letter templates", () => {
  it("keeps a personal letter with handwritten signature space and enclosure on one page", async () => {
    expect(
      await pdfPageCount(
        MitteilungDocument({
          club: {
            vereinsname: org.vereinsname,
            senderLine: "Paul Dresch · Musterweg 3 · 97516 Untereuerheim",
            logoDataUri: null,
          },
          docRef: "MT-2026-0001",
          model: {
            recipientLines: ["Erika Beispiel", "Musterstraße 12", "97516 Untereuerheim"],
            reference: "M-123",
            referenceLabel: "Mitgliedsnummer",
            datum: "06.09.2026",
            subject: "Ihre Mitgliedschaft",
            greeting: "Guten Tag,",
            blocks: [
              {
                kind: "paragraph",
                text: "anbei erhalten Sie die besprochenen Unterlagen. Bei Fragen melden Sie sich bitte bei mir.",
              },
            ],
            closing: "Freundliche Grüße",
            signatureLines: ["Paul Dresch", "Mitgliederverwaltung", "paul@example.org"],
            signatureSpace: true,
            enclosures: ["Beitragsübersicht"],
          },
        }),
      ),
    ).toBe(1);
  });

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

  it("keeps the Kulanz cover on one page so the signature line does not spill", async () => {
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
      unterschriftBild: SIGNATURE_PNG,
    });
    const letter = buildKulanzLetterModel({
      recipient: {
        anrede: "Herr",
        name: "Max Mustermann",
        strasse: "Hauptstraße",
        hausnummer: "1",
        plz: "97516",
        ort: "Untereuerheim",
        vertretungFor: null,
      },
      member: {
        reference: "1234",
        isContact: false,
        name: "Max Mustermann",
        mitgliedsnummer: "1234",
      },
      postings: [posting],
      runDate: "2026-06-04",
      deadlineDate: "2026-06-18",
      vereinsname: org.vereinsname,
      kontaktEmail: "mitgliedschaft@untereuerheim.de",
      sepaFee: "3.00",
      waiveReturnFee: true,
    });
    // Cover + Kündigungsbestätigung = 2 pages. With one open posting the embedded
    // signature line must not push the closing onto a near-empty third page.
    const cnt = await pdfPageCount(
      KulanzSonderkuendigungDocument({ club, letters: [letter], docRef: "KS-2026-0002" }),
    );
    expect(cnt).toBe(2);
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
      brandColor: "#335c99",
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
      brandColor: null,
    });
    await expectValidPdf(EhrungsurkundeDocument({ model: sonder }));
  });

  it("renders the Beitrittserklaerung form (DIN page geometry)", async () => {
    const beitrittClub: BeitrittClub = {
      vereinsname: org.vereinsname,
      ort: org.anschriftOrt,
      anschriftStrasse: org.anschriftStrasse,
      anschriftPlz: org.anschriftPlz,
      anschriftOrt: org.anschriftOrt,
      kontaktEmail: "info@verein.de",
      kontaktTelefon: null,
      glaeubigerId: org.glaeubigerId,
      datenschutzUrl: null,
      satzungUrl: null,
      logoDataUri: null,
    };
    const model = buildBeitrittModel({
      antragsnummer: "ANT-2026-7K3QF9",
      antragstyp: "einzel",
      geschlecht: "m",
      vorname: "Max",
      nachname: "Mustermann",
      geburtsdatum: "1990-05-20",
      strasse: "Hauptstr. 1",
      hausnummer: "2",
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
      mandatsreferenz: "M-AB1234",
      consentAt: new Date("2026-01-10T10:00:00Z"),
      club: beitrittClub,
    });
    await expectValidPdf(BeitrittserklaerungDocument({ model }));
  });
});
