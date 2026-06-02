import { describe, expect, it } from "vitest";
import {
  buildCancellationModel,
  type CancellationClub,
  type CancellationInput,
  formatGermanDate,
  resolveAnrede,
} from "~/server/pdf/cancellation-model";

const club: CancellationClub = {
  vereinsname: "SV Untereuerheim",
  ort: "Untereuerheim",
  kontaktEmail: "info@example.de",
  kontaktTelefon: "0000",
  datenschutzUrl: null,
  satzungUrl: null,
  logoDataUri: null,
};

function baseInput(overrides: Partial<CancellationInput> = {}): CancellationInput {
  return {
    member: {
      anrede: "Frau",
      vorname: "Erika",
      nachname: "Mustermann",
      strasse: "Hauptstr. 1",
      plz: "97508",
      ort: "Untereuerheim",
      geburtsdatum: "1990-05-04",
      mitgliedsnummer: "M-100",
    },
    austrittDatum: "2026-12-31",
    club,
    today: new Date(Date.UTC(2026, 5, 2)),
    ...overrides,
  };
}

describe("formatGermanDate", () => {
  it("formats ISO strings as dd.mm.yyyy", () => {
    expect(formatGermanDate("2026-12-31")).toBe("31.12.2026");
  });
  it("formats Date objects", () => {
    expect(formatGermanDate(new Date(Date.UTC(2026, 0, 9)))).toBe("09.01.2026");
  });
  it("passes through already-formatted and empty values", () => {
    expect(formatGermanDate("31.12.2026")).toBe("31.12.2026");
    expect(formatGermanDate(null)).toBe("");
    expect(formatGermanDate("")).toBe("");
  });
});

describe("resolveAnrede", () => {
  it("handles Herr / Frau including Linear's free text", () => {
    expect(resolveAnrede("Herr", "Max", "Mustermann")).toEqual({
      greeting: "Sehr geehrter Herr Mustermann",
      anredeZeile: "Herrn",
    });
    expect(resolveAnrede("Herrn", "Max", "Mustermann").anredeZeile).toBe("Herrn");
    expect(resolveAnrede("Frau", "Erika", "Mustermann")).toEqual({
      greeting: "Sehr geehrte Frau Mustermann",
      anredeZeile: "Frau",
    });
  });
  it("falls back to a neutral greeting when no salutation", () => {
    expect(resolveAnrede(null, "Alex", "Schmidt")).toEqual({
      greeting: "Guten Tag Alex Schmidt",
      anredeZeile: "",
    });
  });
});

describe("buildCancellationModel", () => {
  it("builds the standard single-member letter", () => {
    const m = buildCancellationModel(baseInput());
    expect(m.subject).toBe("Bestätigung Ihres Austritts aus dem Verein");
    expect(m.anrede).toBe("Sehr geehrte Frau Mustermann,");
    expect(m.recipient.anredeZeile).toBe("Frau");
    expect(m.recipient.name).toBe("Erika Mustermann");
    expect(m.recipient.plzOrt).toBe("97508 Untereuerheim");
    expect(m.austrittDatum).toBe("31.12.2026");
    expect(m.ortDatum).toBe("Untereuerheim, den 02.06.2026");
    expect(m.member.geburtsdatum).toBe("04.05.1990");
    expect(m.isFamily).toBe(false);
    expect(m.istEmpfaengerAbweichend).toBe(false);
    expect(m.displayName).toBe("Mustermann, Erika");
    expect(m.combinedMitgliedsnummer).toBe("M-100");
    // No em/en dashes anywhere in the rendered copy.
    const copy = [m.subject, m.bodyIntro, m.bodyClause, m.bodyThanks, m.closing].join(" ");
    expect(copy).not.toMatch(/[–—]/);
  });

  it("uses the different-recipient wording and address", () => {
    const m = buildCancellationModel(
      baseInput({
        empfaengerAbweichend: true,
        empfaenger: {
          anrede: "Herr",
          vorname: "Hans",
          nachname: "Vater",
          strasse: "Elternweg 2",
          plz: "97000",
          ort: "Woanders",
        },
      }),
    );
    expect(m.istEmpfaengerAbweichend).toBe(true);
    expect(m.subject).toBe("Bestätigung des Austritts von Erika Mustermann aus dem Verein");
    expect(m.anrede).toBe("Sehr geehrter Herr Vater,");
    expect(m.recipient.name).toBe("Hans Vater");
    expect(m.recipient.plzOrt).toBe("97000 Woanders");
    expect(m.bodyClause).toContain("von Ihnen erteilte SEPA-Lastschriftmandat");
    expect(m.bodyThanks).toContain("für die Zeit von Erika Mustermann");
  });

  it("falls back recipient address to the member when override fields are blank", () => {
    const m = buildCancellationModel(
      baseInput({
        empfaengerAbweichend: true,
        empfaenger: { vorname: "Hans", nachname: "Vater" },
      }),
    );
    expect(m.recipient.plzOrt).toBe("97508 Untereuerheim");
    expect(m.recipient.strasse).toBe("Hauptstr. 1");
  });

  it("ignores the different-recipient flag when name is missing", () => {
    const m = buildCancellationModel(
      baseInput({ empfaengerAbweichend: true, empfaenger: { vorname: "", nachname: "" } }),
    );
    expect(m.istEmpfaengerAbweichend).toBe(false);
  });

  it("builds the family letter and combines member numbers", () => {
    const m = buildCancellationModel(
      baseInput({
        isFamily: true,
        familienmitglieder: [
          {
            vorname: "Kind",
            nachname: "Mustermann",
            geburtsdatum: "2015-03-02",
            mitgliedsnummer: "M-101",
          },
          { vorname: "", nachname: "" },
        ],
      }),
    );
    expect(m.isFamily).toBe(true);
    expect(m.subject).toBe("Bestätigung des Austritts der Familienmitgliedschaft aus dem Verein");
    // The empty family row is dropped.
    expect(m.familienmitglieder).toHaveLength(1);
    expect(m.familienmitglieder[0]?.geburtsdatum).toBe("02.03.2015");
    expect(m.combinedMitgliedsnummer).toBe("Erika Mustermann: M-100, Kind Mustermann: M-101");
    expect(m.displayName).toBe("Mustermann, Erika | Mustermann, Kind (Familie)");
    expect(m.bodyClause).toContain("Familienmitgliedschaft endet somit");
  });

  it("does not treat an empty family list as a family letter", () => {
    const m = buildCancellationModel(baseInput({ isFamily: true, familienmitglieder: [] }));
    expect(m.isFamily).toBe(false);
    expect(m.subject).toBe("Bestätigung Ihres Austritts aus dem Verein");
  });
});
