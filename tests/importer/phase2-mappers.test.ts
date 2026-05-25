import { describe, expect, it } from "vitest";
import {
  mapFachverbandRow,
  mapLastProtRow,
  mapLastProtSRow,
  mapMgartDatRow,
  mapSollStellungRow,
  mapSportartRow,
} from "~/server/importer/linear-mapper";

describe("mapSollStellungRow", () => {
  it("returns null when any natural-key field is missing", () => {
    expect(mapSollStellungRow({})).toBeNull();
    expect(mapSollStellungRow({ AdrNr: 1, Jahr: 2018 })).toBeNull();
  });

  it("maps the canonical fields", () => {
    const row = mapSollStellungRow({
      AdrNr: 7,
      Jahr: 2018,
      VertragNr: "11",
      Art: 100,
      Zeitraum: 2,
      Datum: "2018-02-25 00:00:00.000000",
      Betrag: "162.00000000",
      Bezahlt: "162.00000000",
      Offen: "0.00000000",
      Mahnstuffe: 0,
      GUID: "e7dc8e6b-fd4d-11f0-ac55-00155d027f04",
      MandatsNr: "7081611",
    });
    expect(row).toMatchObject({
      adrNr: 7,
      jahr: 2018,
      vertragNr: "11",
      art: 100,
      zeitraum: 2,
      betrag: "162",
      bezahlt: "162",
      offen: "0",
      mahnstufe: 0,
      guid: "e7dc8e6b-fd4d-11f0-ac55-00155d027f04",
      mandatsNr: "7081611",
    });
    expect(row?.falligkeitsdatum).toBeInstanceOf(Date);
  });

  it("falls back to Datum when FalligkeitDatum is null", () => {
    const row = mapSollStellungRow({
      AdrNr: 1,
      Jahr: 2020,
      VertragNr: "1",
      Art: 100,
      Zeitraum: 1,
      Datum: "2020-03-15 00:00:00.000000",
      FalligkeitDatum: null,
      Betrag: "60",
      Offen: "60",
    });
    expect(row?.falligkeitsdatum?.toISOString().slice(0, 10)).toBe("2020-03-15");
  });
});

describe("mapSportartRow", () => {
  it("requires KZ, NUMMER, and LfdNr", () => {
    expect(mapSportartRow({})).toBeNull();
    expect(mapSportartRow({ KZ: "BLSV" })).toBeNull();
    expect(mapSportartRow({ KZ: "BLSV", NUMMER: "0001" })).toBeNull();
  });

  it("maps a BLSV-style row", () => {
    expect(
      mapSportartRow({
        KZ: "BLSV",
        NUMMER: "0001",
        SPORTART: "Adventure Race",
        VerbandNr: null,
        LfdNr: 1,
      }),
    ).toEqual({
      kz: "BLSV",
      nummer: "0001",
      sportart: "Adventure Race",
      verbandNr: null,
      lfdNr: 1,
    });
  });
});

describe("mapFachverbandRow", () => {
  it("trims and preserves the Fachverband name", () => {
    const row = mapFachverbandRow({
      KZ: "BLSV",
      NUMMER: "17",
      FACHVERBAN: "Bayerischer Leichtathletik-Verband e.V.",
      Kn: null,
      LfdNr: 2151,
    });
    expect(row).toEqual({
      kz: "BLSV",
      nummer: "17",
      fachverband: "Bayerischer Leichtathletik-Verband e.V.",
      kn: null,
      lfdNr: 2151,
    });
  });
});

describe("mapMgartDatRow", () => {
  it("returns null without (Art, Jahr, Monat)", () => {
    expect(mapMgartDatRow({})).toBeNull();
    expect(mapMgartDatRow({ Art: 100, Jahr: 2018 })).toBeNull();
  });

  it("maps the price + percent + datum fields", () => {
    const row = mapMgartDatRow({
      Art: 100,
      Jahr: 2018,
      Monat: 1,
      Betrag: "54.00000000",
      Prozent: "0.00000000",
      Datum: "2018-01-01",
    });
    expect(row).toMatchObject({
      art: 100,
      jahr: 2018,
      monat: 1,
      betrag: "54",
      prozent: "0",
    });
    expect((row?.datum as Date).toISOString().slice(0, 10)).toBe("2018-01-01");
  });
});

describe("mapLastProtRow", () => {
  it("requires the full natural key + XML name", () => {
    expect(mapLastProtRow({}, false)).toBeNull();
  });

  it("stores the XML blob verbatim and tags the archive flag", () => {
    const active = mapLastProtRow(
      {
        ID: 1,
        Datum: "2024-01-15 09:30:00.000000",
        Falligkeitsdatum: "2024-02-01 00:00:00.000000",
        Benutzer: "Kassier",
        GUID: "abc-123",
        XMLName: "SEPAXML202401150930.xml",
        XMLData: "<?xml version=\"1.0\"?><Document/>",
      },
      false,
    );
    expect(active).toMatchObject({
      id: 1,
      benutzer: "Kassier",
      guid: "abc-123",
      xmlName: "SEPAXML202401150930.xml",
      archived: "false",
    });
    expect(active?.xmlData).toBe("<?xml version=\"1.0\"?><Document/>");

    const archived = mapLastProtRow(
      {
        ID: 1,
        Datum: "2024-01-15 09:30:00.000000",
        Benutzer: "Kassier",
        GUID: "abc-123",
        XMLName: "SEPAXML.xml",
      },
      true,
    );
    expect(archived?.archived).toBe("true");
  });
});

describe("mapLastProtSRow", () => {
  it("requires both GUID columns", () => {
    expect(mapLastProtSRow({}, false)).toBeNull();
    expect(mapLastProtSRow({ SepaGUID: "x" }, false)).toBeNull();
  });

  it("maps the per-debit item", () => {
    expect(
      mapLastProtSRow(
        {
          SepaGUID: "sepa-guid",
          SollGUID: "soll-guid",
          Betrag: "60.00",
          Offen: "0.00",
          RuckLastGUID: null,
        },
        false,
      ),
    ).toEqual({
      sepaGuid: "sepa-guid",
      sollGuid: "soll-guid",
      betrag: "60",
      offen: "0",
      ruckLastGuid: null,
      archived: "false",
    });
  });
});
