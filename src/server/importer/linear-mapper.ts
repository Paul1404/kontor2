/**
 * Linear → SVUWV row mapping. Reads raw values out of a Linear `adresse`,
 * `mgart`, `mgvert`, or `adrsepa` row (already coerced into JS primitives
 * by `sql-tokenizer.ts`) and produces typed objects ready for Drizzle insert.
 *
 * Encryption: IBAN columns go through `encryptedText` automatically, but
 * since we drive plain inserts/updates we emit the plain string and let the
 * Drizzle custom-type handle the AES-GCM wrap. The `*_last4` mirror is
 * computed here so it's searchable / displayable without decryption.
 */

import type { Cell } from "~/server/importer/sql-tokenizer";
import {
  coerceBool,
  coerceDate,
  coerceDecimal,
  coerceInt,
  coerceStr,
} from "~/server/importer/sql-tokenizer";
import { paysByDirectDebit } from "~/server/sepa/direct-debit";

export type LinearRow = Record<string, Cell>;

// Member rows are translated to the clean schema by `translateLinearMember`
// (`~/server/importer/translate-member`), not mapped here. The functions below
// map the remaining Linear tables (fee types, contracts, SEPA, etc.).

export function mapFeeTypeRow(d: LinearRow): Record<string, unknown> | null {
  const art = coerceInt(d.Art ?? null);
  if (art === null) return null;
  return {
    art,
    grundlage: coerceStr(d.Grundlage ?? null, 20),
    sollstellung: coerceStr(d.Sollstellung ?? null, 10),
    fibukonto: coerceInt(d.Fibukonto ?? null),
    bezeichnung: coerceStr(d.Bezeichnung ?? null, 150),
    valuta: coerceStr(d.Valuta ?? null, 3),
    kontoname: coerceStr(d.Kontoname ?? null, 40),
    steuer: coerceStr(d.Steuer ?? null, 1),
    minBetrag: coerceDecimal(d.MinBetrag ?? null),
    maxBetrag: coerceDecimal(d.MaxBetrag ?? null),
    feld: coerceStr(d.Feld ?? null, 30),
    wert: coerceStr(d.Wert ?? null, 1),
    anhArt: coerceInt(d.AnhArt ?? null),
    anhBez: coerceStr(d.AnhBez ?? null, 40),
    edit: coerceStr(d.Edit ?? null, 1),
    sollNichtErlaubt: coerceStr(d.SollNichtErlaubt ?? null, 1),
    spende: coerceStr(d.Spende ?? null, 1),
    spendenvorlage: coerceStr(d.Spendenvorlage ?? null, 80),
    koSt: coerceInt(d.KoSt ?? null),
    koTr: coerceInt(d.KoTr ?? null),
    abteilung: coerceStr(d.Abteilung ?? null, 80),
    eFeld: coerceStr(d.E_Feld ?? null, 30),
    eMinBetrag: coerceDecimal(d.E_MinBetrag ?? null),
    eMaxBetrag: coerceDecimal(d.E_MaxBetrag ?? null),
    eWert: coerceStr(d.E_Wert ?? null, 1),
    eVerkn: coerceStr(d.E_Verkn ?? null, 1),
    eProz: coerceDecimal(d.E_Proz ?? null),
    varField: coerceStr(d.Var ?? null, 1),
    tBetrag1: coerceDecimal(d.TBetrag1 ?? null),
    tBetrag2: coerceDecimal(d.TBetrag2 ?? null),
    fibukonto1: coerceInt(d.Fibukonto1 ?? null),
    fibukonto2: coerceInt(d.Fibukonto2 ?? null),
    koSt1: coerceInt(d.KoSt1 ?? null),
    koSt2: coerceInt(d.KoSt2 ?? null),
    falligkeitDatum1: coerceDate(d.FalligkeitDatum1 ?? null),
    falligkeitDatum2: coerceDate(d.FalligkeitDatum2 ?? null),
    falligkeitDatum3: coerceDate(d.FalligkeitDatum3 ?? null),
    falligkeitDatum4: coerceDate(d.FalligkeitDatum4 ?? null),
    falligkeitTag: coerceInt(d.FalligkeitTag ?? null),
    koStG: coerceInt(d.KoStG ?? null),
    betrag1: coerceDecimal(d.Betrag1 ?? null),
    nichAktiv: coerceStr(d.NichAktiv ?? null, 1),
    artType: coerceInt(d.ArtType ?? null),
  };
}

export function mapContractRow(d: LinearRow): Record<string, unknown> | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  const vertragNr = coerceStr(d.VertragNr ?? null, 20);
  const art = coerceInt(d.Art ?? null);
  if (adrNr === null || !vertragNr || art === null) return null;
  const lastschrift = coerceStr(d.Lastschrift ?? null, 1);
  const aufRechnung = coerceStr(d.AufRechnung ?? null, 4);
  return {
    adrNr,
    vertragNr,
    art,
    artName: coerceStr(d.ArtName ?? null, 150),
    mitglNr: coerceStr(d.MitglNr ?? null, 50),
    sollstellung: coerceStr(d.Sollstellung ?? null, 20),
    vertragBegin: coerceDate(d.VertragBegin ?? null),
    vertragEnde: coerceDate(d.VertragEnde ?? null),
    aufnahmegeb: coerceDecimal(d.Aufnahmegeb ?? null),
    betrag: coerceDecimal(d.Betrag ?? null),
    kuendAnzahl: coerceInt(d.KuendAnzahl ?? null),
    keundZeitraum: coerceStr(d.KeundZeitraum ?? null, 8),
    keundBis: coerceStr(d.KeundBis ?? null, 15),
    gekuendAm: coerceDate(d.GekuendAm ?? null),
    gekuendZum: coerceDate(d.GekuendZum ?? null),
    frueGekuendAm: coerceDate(d.FrueGekuendAM ?? null),
    frueGekuendZum: coerceDate(d.FrueGekuendZum ?? null),
    autoVerlZahl: coerceInt(d.AutoVerlZahl ?? null),
    autoVerlZeit: coerceStr(d.AutoVerlZeit ?? null, 10),
    aufRechnung,
    // Normalize Linear's blank-means-direct-debit quirk once, here at the
    // edge, so runtime queries read a plain boolean instead of reinterpreting
    // `lastschrift`/`aufRechnung` themselves.
    isDirectDebit: paysByDirectDebit(lastschrift, aufRechnung),
    anteilig: coerceStr(d.Anteilig ?? null, 1),
    multipl: coerceInt(d.Multipl ?? null),
    steuer: coerceStr(d.Steuer ?? null, 1),
    abwAdrNr: coerceInt(d.AbwAdrNr ?? null),
    verwZw1: coerceStr(d.VerwZw1 ?? null, 60),
    verwZw2: coerceStr(d.VerwZw2 ?? null, 60),
    verwZw3: coerceStr(d.VerwZw3 ?? null, 60),
    verwZw4: coerceStr(d.VerwZw4 ?? null, 60),
    lastschrift,
    blzV: coerceStr(d.BLZ_V ?? null, 15),
    bankV: coerceStr(d.Bank_V ?? null, 60),
    kontoV: coerceStr(d.Konto_V ?? null, 15),
    ktoInhV: coerceStr(d.KtoInh_V ?? null, 60),
    monatAb: coerceInt(d.MonatAb ?? null),
    rgNr: coerceInt(d.RgNr ?? null),
    prenotifikation: coerceStr(d.Prenotifikation ?? null, 1),
    abwKontoInh: coerceStr(d.AbwKontoInh ?? null, 50),
    falligkeitDatum1: coerceDate(d.FalligkeitDatum1 ?? null),
    falligkeitDatum2: coerceDate(d.FalligkeitDatum2 ?? null),
    falligkeitDatum3: coerceDate(d.FalligkeitDatum3 ?? null),
    falligkeitDatum4: coerceDate(d.FalligkeitDatum4 ?? null),
    falligkeitTag: coerceInt(d.FalligkeitTag ?? null),
  };
}

export function mapVerknRow(d: LinearRow): Record<string, unknown> | null {
  const fromAdrNr = coerceInt(d.ADRNR ?? d.AdrNr ?? null);
  const toAdrNr = coerceInt(d.VERKN ?? d.Verkn ?? null);
  if (fromAdrNr === null || toAdrNr === null) return null;
  return {
    fromAdrNr,
    toAdrNr,
    beziehung: coerceStr(d.Beziehung ?? null, 40),
    matchcode: coerceStr(d.Matchcode ?? null, 40),
    name: coerceStr(d.Name ?? null, 40),
    anrede: coerceStr(d.Anrede ?? null, 6),
    telefon: coerceStr(d.Telefon ?? null, 30),
    abteilung: coerceStr(d.Abteilung ?? null, 40),
    nachname: coerceStr(d.Nachname ?? null, 40),
    art: coerceStr(d.Art ?? null, 2),
    artName: coerceStr(d.ArtName ?? null, 20),
    rg: coerceStr(d.Rg ?? null, 1),
    funktion: coerceStr(d.Funktion ?? null, 80),
    post: coerceStr(d.Post ?? null, 1),
    email: coerceStr(d.EMail ?? null, 250),
    eb: coerceStr(d.EB ?? null, 1),
    vkennung: coerceStr(d.VKennung ?? null, 60),
    datVon: coerceDate(d.DatVon ?? null),
    datBis: coerceDate(d.DatBis ?? null),
    vEmail: coerceStr(d.VEmail ?? null, 250),
    kennungV1: coerceStr(d.KennungV1 ?? null, 60),
    kennungV2: coerceStr(d.KennungV2 ?? null, 60),
    kennungV3: coerceStr(d.KennungV3 ?? null, 60),
    kennungV4: coerceStr(d.KennungV4 ?? null, 60),
    kennungV5: coerceStr(d.KennungV5 ?? null, 60),
  };
}

/**
 * Linear `inter` row → Nr → name lookup entry. Linear stores the list of
 * available "Interessen" (= Abteilungen in our model) as a numbered table;
 * `interes` rows reference these by number.
 */
export function mapInterRow(d: LinearRow): { nr: number; name: string } | null {
  const nr = coerceInt(d.Nr ?? null);
  const name = coerceStr(d.Interesse ?? null, 80);
  if (nr === null || !name) return null;
  return { nr, name };
}

/**
 * Linear `interes` row → per-member Abteilungs-Mitgliedschaft. `Interesse`
 * is a numeric foreign key into `inter`; resolution happens later in the
 * ingest pipeline once the `inter` lookup is available.
 */
export type InteresMapped = {
  adrNr: number;
  interesNr: number;
  eintritt: Date | null;
  austritt: Date | null;
};

export function mapInteresRow(d: LinearRow): InteresMapped | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  // The `Interesse` column is declared `varchar(30)` but holds the numeric
  // FK as a string in practice.
  const interesNr = coerceInt(d.Interesse ?? null);
  if (adrNr === null || interesNr === null) return null;
  return {
    adrNr,
    interesNr,
    eintritt: coerceDate(d.Eintritt ?? null),
    austritt: coerceDate(d.Austritt ?? null),
  };
}

/**
 * Linear `mgsolln` row → partially-mapped Sollstellung. The pipeline still
 * has to resolve `adrNr` → memberId and (adrNr, vertragNr) → contractId, so
 * this returns the natural-key fields untouched. `Mahnstuffe` (Linear's
 * typo for Mahnstufe) is preserved as-is; status is derived from the row's
 * `Bezahlt` vs `Offen` balance.
 */
export type SollStellungMapped = {
  adrNr: number;
  jahr: number;
  vertragNr: string;
  art: number;
  zeitraum: number;
  betrag: string | null;
  bezahlt: string | null;
  offen: string | null;
  mahnstufe: number;
  falligkeitsdatum: Date | null;
  guid: string | null;
  mandatsNr: string | null;
};

export function mapSollStellungRow(d: LinearRow): SollStellungMapped | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  const jahr = coerceInt(d.Jahr ?? null);
  const vertragNr = coerceStr(d.VertragNr ?? null, 10);
  const art = coerceInt(d.Art ?? null);
  const zeitraum = coerceInt(d.Zeitraum ?? null);
  if (adrNr === null || jahr === null || !vertragNr || art === null || zeitraum === null) {
    return null;
  }
  return {
    adrNr,
    jahr,
    vertragNr,
    art,
    zeitraum,
    betrag: coerceDecimal(d.Betrag ?? null),
    bezahlt: coerceDecimal(d.Bezahlt ?? null),
    offen: coerceDecimal(d.Offen ?? null),
    mahnstufe: coerceInt(d.Mahnstuffe ?? null) ?? 0,
    falligkeitsdatum: coerceDate(d.FalligkeitDatum ?? null) ?? coerceDate(d.Datum ?? null),
    guid: coerceStr(d.GUID ?? null, 64),
    mandatsNr: coerceStr(d.MandatsNr ?? null, 35),
  };
}

export function mapSportartRow(d: LinearRow): Record<string, unknown> | null {
  const kz = coerceStr(d.KZ ?? null, 50);
  const nummer = coerceStr(d.NUMMER ?? null, 20);
  const lfdNr = coerceInt(d.LfdNr ?? null);
  if (!kz || !nummer || lfdNr === null) return null;
  return {
    kz,
    nummer,
    sportart: coerceStr(d.SPORTART ?? null, 120),
    verbandNr: coerceStr(d.VerbandNr ?? null, 20),
    lfdNr,
  };
}

export function mapFachverbandRow(d: LinearRow): Record<string, unknown> | null {
  const kz = coerceStr(d.KZ ?? null, 50);
  const nummer = coerceStr(d.NUMMER ?? null, 20);
  const lfdNr = coerceInt(d.LfdNr ?? null);
  if (!kz || !nummer || lfdNr === null) return null;
  return {
    kz,
    nummer,
    fachverband: coerceStr(d.FACHVERBAN ?? null, 120),
    kn: coerceStr(d.Kn ?? null, 1),
    lfdNr,
  };
}

export function mapMgartDatRow(d: LinearRow): Record<string, unknown> | null {
  const art = coerceInt(d.Art ?? null);
  const jahr = coerceInt(d.Jahr ?? null);
  const monat = coerceInt(d.Monat ?? null);
  if (art === null || jahr === null || monat === null) return null;
  return {
    art,
    jahr,
    monat,
    betrag: coerceDecimal(d.Betrag ?? null),
    prozent: coerceDecimal(d.Prozent ?? null),
    datum: coerceDate(d.Datum ?? null),
  };
}

/**
 * Linear `lastprot` / `lastproth` row → archived SEPA run header. The
 * `XMLData` blob is preserved verbatim so admins can reconstruct exactly
 * what was submitted to the bank. `archived=true` for `lastproth` (Linear's
 * history journal for purged runs), `false` for the live `lastprot`.
 */
export function mapLastProtRow(d: LinearRow, archived: boolean): Record<string, unknown> | null {
  const id = coerceInt(d.ID ?? null);
  const datum = coerceDate(d.Datum ?? null);
  const benutzer = coerceStr(d.Benutzer ?? null, 250);
  const guid = coerceStr(d.GUID ?? null, 64);
  const xmlName = coerceStr(d.XMLName ?? null, 120);
  if (id === null || !datum || !benutzer || !guid || !xmlName) return null;
  return {
    id,
    datum,
    falligkeitsdatum: coerceDate(d.Falligkeitsdatum ?? null),
    benutzer,
    guid,
    xmlName,
    xmlData: typeof d.XMLData === "string" ? d.XMLData : null,
    archived: archived ? "true" : "false",
  };
}

export function mapLastProtSRow(d: LinearRow, archived: boolean): Record<string, unknown> | null {
  const sepaGuid = coerceStr(d.SepaGUID ?? null, 64);
  const sollGuid = coerceStr(d.SollGUID ?? null, 36);
  if (!sepaGuid || !sollGuid) return null;
  return {
    sepaGuid,
    sollGuid,
    betrag: coerceDecimal(d.Betrag ?? null),
    offen: coerceDecimal(d.Offen ?? null),
    ruckLastGuid: coerceStr(d.RuckLastGUID ?? null, 36),
    archived: archived ? "true" : "false",
  };
}

export function mapSepaRow(d: LinearRow): Record<string, unknown> | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  const mandatsNr = coerceStr(d.MandatsNr ?? null, 50);
  if (adrNr === null || !mandatsNr) return null;
  return {
    adrNr,
    mandatsNr,
    mandKey: coerceStr(d.MandKey ?? null, 35),
    lastschriftart: coerceStr(d.Lastschriftart ?? null, 30),
    typ: coerceStr(d.Typ ?? null, 1),
    status: coerceStr(d.Status ?? null, 30),
    angelegtAm: coerceDate(d.AngelegtAm ?? null),
    gultigBis: coerceDate(d.GultigBis ?? null),
    unterschriftDatum: coerceDate(d.UnterschriftDatum ?? null),
    ersteVerwendung: coerceDate(d.ErsteVerwendung ?? null),
    letzteVerwendung: coerceDate(d.LetzteVerwendung ?? null),
    widerrufenAm: coerceDate(d.WiderrufenAm ?? null),
    gueltigAb: coerceDate(d.GueltigAb ?? null),
    letzteVerwendungAlt: coerceDate(d.LetzteVerwendungAlt ?? null),
    gultigBisAlt: coerceDate(d.GultigBisAlt ?? null),
    isDeleted: coerceBool(d.IsDeleted ?? null),
  };
}
