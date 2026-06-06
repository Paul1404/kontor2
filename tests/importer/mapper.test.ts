import { describe, expect, it } from "vitest";
import {
  mapContractRow,
  mapInteresRow,
  mapInterRow,
  mapSepaRow,
  mapVerknRow,
} from "~/server/importer/linear-mapper";

// Member rows are translated by translateLinearMember -- see
// tests/importer/translate-member.test.ts.

describe("mapContractRow / mapSepaRow", () => {
  it("contracts require AdrNr, VertragNr, Art", () => {
    expect(mapContractRow({ AdrNr: 1, VertragNr: "V1" })).toBeNull();
    const c = mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5, Betrag: "12,50" });
    expect(c).not.toBeNull();
    expect(c?.betrag).toBe("12.5");
  });

  it("normalizes is_direct_debit at the edge from Linear's lastschrift/aufRechnung", () => {
    // Blank lastschrift = direct debit (Linear's default for the common case).
    expect(mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5 })?.isDirectDebit).toBe(true);
    // Explicit "J" = direct debit.
    expect(
      mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5, Lastschrift: "J" })?.isDirectDebit,
    ).toBe(true);
    // Explicit non-"J" = not direct debit.
    expect(
      mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5, Lastschrift: "N" })?.isDirectDebit,
    ).toBe(false);
    // Invoice payer (aufRechnung = "J") is never direct debit, blank lastschrift or not.
    expect(
      mapContractRow({ AdrNr: 1, VertragNr: "V1", Art: 5, AufRechnung: "J" })?.isDirectDebit,
    ).toBe(false);
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
