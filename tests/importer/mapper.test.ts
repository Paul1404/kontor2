import { describe, expect, it } from "vitest";
import {
  mapContractRow,
  mapInteresRow,
  mapInterRow,
  mapMemberRow,
  mapSepaRow,
  mapVerknRow,
} from "~/server/importer/linear-mapper";

describe("mapMemberRow", () => {
  it("returns null when AdrNr is missing", () => {
    expect(mapMemberRow({})).toBeNull();
  });

  it("maps the SVUMS subset correctly", () => {
    const row = mapMemberRow({
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
      Telefon1: "09382-12345",
      Telefon2: "+49 170 0000000",
      Geburtsdatum: "1990-05-12 00:00:00.000000",
      Eintritt: "2010-01-01 00:00:00",
      Geloscht: false,
      Aktiv: "Y",
      AktivPasiv: "A",
      Abteilung: "Fußball, Tennis",
      IBAN1: "DE89370400440532013000",
      BIC1: "COBADEFFXXX",
      mandatsrefenz: "MAN-001",
    });
    expect(row).toBeTruthy();
    if (!row) return;
    expect(row.adrNr).toBe(42);
    expect(row.mitglnr).toBe("M-0042");
    expect(row.eMailName).toBe("anna@example.com");
    expect(row.eintritt).toBeInstanceOf(Date);
    expect(row.geloscht).toBe(false);
    expect(row.aktivPasiv).toBe("A");
    expect(row.abteilung).toBe("Fußball, Tennis");
    expect(row.iban1).toBe("DE89370400440532013000");
    expect(row.iban1Last4).toBe("3000");
    expect(row.mandatsrefenz).toBe("MAN-001");
  });

  it("falls back to Telefon3 for email when EMailName missing", () => {
    const row = mapMemberRow({
      AdrNr: 1,
      Telefon3: "old@example.com",
    });
    expect(row?.eMailName).toBe("old@example.com");
  });

  it("zero-dates become null", () => {
    const row = mapMemberRow({ AdrNr: 1, Eintritt: "0000-00-00 00:00:00" });
    expect(row?.eintritt).toBeNull();
  });
});

describe("mapContractRow / mapSepaRow", () => {
  it("contracts require AdrNr, VertragNr, Art", () => {
    expect(mapContractRow({ AdrNr: 1, VertragNr: "V1" })).toBeNull();
    const c = mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5, Betrag: "12,50" });
    expect(c).not.toBeNull();
    expect(c?.betrag).toBe("12.5");
  });

  it("sepa requires AdrNr and MandatsNr", () => {
    expect(mapSepaRow({ AdrNr: 1 })).toBeNull();
    const s = mapSepaRow({
      AdrNr: 7,
      MandatsNr: "M1",
      Status: "AKTIV",
      GueltigAb: "2022-01-01",
    });
    expect(s?.status).toBe("AKTIV");
    expect(s?.gueltigAb).toBeInstanceOf(Date);
  });
});

describe("mapVerknRow", () => {
  it("requires both ADRNR and VERKN", () => {
    expect(mapVerknRow({})).toBeNull();
    expect(mapVerknRow({ ADRNR: 1 })).toBeNull();
    expect(mapVerknRow({ VERKN: 2 })).toBeNull();
  });

  it("maps the Linear verkn pair with full kind", () => {
    // Real-world sample shape from a Linear datesicherung.sql dump.
    const row = mapVerknRow({
      ADRNR: 13,
      VERKN: 14,
      Beziehung: "Familienmitglied",
      Name: "Schmidt",
      Funktion: "Ehepartner",
    });
    expect(row).not.toBeNull();
    expect(row?.fromAdrNr).toBe(13);
    expect(row?.toAdrNr).toBe(14);
    expect(row?.beziehung).toBe("Familienmitglied");
    expect(row?.name).toBe("Schmidt");
    expect(row?.funktion).toBe("Ehepartner");
  });

  it("preserves sparse pair-only rows (NULL Beziehung)", () => {
    // The reference dump has many rows that are just (ADRNR, VERKN) with
    // every other column NULL -- these still need to come through so the
    // direction-of-link is preserved.
    const row = mapVerknRow({ ADRNR: 8, VERKN: 517 });
    expect(row?.fromAdrNr).toBe(8);
    expect(row?.toAdrNr).toBe(517);
    expect(row?.beziehung).toBeNull();
    expect(row?.name).toBeNull();
  });

  it("decimal sources from MySQL decimal(19,8) coerce to int", () => {
    // Linear stores ADRNR/VERKN as decimal(19,8) which the tokenizer yields
    // as JS numbers like 8.00000000. coerceInt must truncate cleanly.
    const row = mapVerknRow({ ADRNR: 13.0, VERKN: 742.0 });
    expect(row?.fromAdrNr).toBe(13);
    expect(row?.toAdrNr).toBe(742);
  });
});

describe("mapInterRow", () => {
  it("returns null without Nr or Interesse", () => {
    expect(mapInterRow({})).toBeNull();
    expect(mapInterRow({ Nr: 1 })).toBeNull();
    expect(mapInterRow({ Interesse: "Fussball" })).toBeNull();
  });

  it("maps the Nr → Interesse lookup row", () => {
    expect(mapInterRow({ Nr: 2, Interesse: "Fussball" })).toEqual({
      nr: 2,
      name: "Fussball",
    });
  });
});

describe("mapInteresRow", () => {
  it("returns null without AdrNr or Interesse", () => {
    expect(mapInteresRow({})).toBeNull();
    expect(mapInteresRow({ AdrNr: 5 })).toBeNull();
    expect(mapInteresRow({ Interesse: "2" })).toBeNull();
  });

  it("maps the per-member abteilung membership row", () => {
    // Real shape from datesicherung.sql: Interesse comes through as a
    // varchar that holds the numeric FK into `inter`.
    const m = mapInteresRow({
      AdrNr: 5,
      Interesse: "5",
      Eintritt: "1986-12-22 00:00:00.000000",
      Austritt: null,
    });
    expect(m).not.toBeNull();
    expect(m?.adrNr).toBe(5);
    expect(m?.interesNr).toBe(5);
    expect(m?.eintritt).toBeInstanceOf(Date);
    expect(m?.austritt).toBeNull();
  });
});
