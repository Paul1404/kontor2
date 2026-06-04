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

import { lastFour } from "~/server/crypto/encrypt";
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

/**
 * Linear `adresse` row → `members` insert payload. We carry every column
 * across so the database is a lossless mirror; the `iban1Last4` mirror is
 * computed here for searchability.
 */
export function mapMemberRow(d: LinearRow): Record<string, unknown> | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  if (adrNr === null) return null;

  const m: Record<string, unknown> = {
    adrNr,
    firma1: coerceStr(d.Firma1 ?? null, 40),
    firma2: coerceStr(d.Firma2 ?? null, 40),
    firma3: coerceStr(d.Firma3 ?? null, 40),
    firma4: coerceStr(d.Firma4 ?? null, 100),
    kurzname: coerceStr(d.Kurzname ?? null, 40),
    anrede: coerceStr(d.Anrede ?? null, 20),
    anrede2: coerceStr(d.Anrede2 ?? null, 80),
    anredetitel: coerceStr(d.Anredetitel ?? null, 60),
    vorname: coerceStr(d.Vorname ?? null, 30),
    nachname: coerceStr(d.Nachname ?? null, 40),
    strasse: coerceStr(d.Strasse ?? null, 50),
    plz: coerceStr(d.PLZ ?? null, 15),
    ort: coerceStr(d.Ort ?? null, 40),
    lkz: coerceStr(d.LKZ ?? null, 5),
    postfachPlz: coerceInt(d.Postfach_PLZ ?? null),
    landesvorwahl: coerceInt(d.Landesvorwahl ?? null),
    vorwahl: coerceStr(d.Vorwahl ?? null, 12),
    telefon1: coerceStr(d.Telefon1 ?? null, 40),
    telefon2: coerceStr(d.Telefon2 ?? null, 40),
    telefon4: coerceStr(d.Telefon4 ?? null, 40),
    betreung: coerceStr(d.Betreung ?? null, 80),
    fax: coerceStr(d.Fax ?? null, 40),
    erfDatum: coerceDate(d.Erf_Datum ?? null),
    adressart: coerceStr(d.Adressart ?? null, 11),
    letztKontakt: coerceDate(d.LetztKontakt ?? null),
    kennung: coerceStr(d.Kennung ?? null, 80),
    kontaktwoher: coerceStr(d.Kontaktwoher ?? null, 80),
    widervorlage: coerceDate(d.Widervorlage ?? null),
    wVorlTage: coerceInt(d.WVorl_Tage ?? null),
    firma1Rech: coerceStr(d.Firma1_Rech ?? null, 30),
    firma2Rech: coerceStr(d.Firma2_Rech ?? null, 30),
    firma3Rech: coerceStr(d.Firma3_Rech ?? null, 30),
    strasseRech: coerceStr(d.Strasse_Rech ?? null, 40),
    plzRech: coerceStr(d.PLZ_Rech ?? null, 8),
    ortRech: coerceStr(d.Ort_Rech ?? null, 40),
    plzRechPostf: coerceStr(d.PLZ_Rech_Postf ?? null, 5),
    postachRech: coerceStr(d.Postach_Rech ?? null, 10),
    firma1Lief: coerceStr(d.Firma1_Lief ?? null, 30),
    firma2Lief: coerceStr(d.Firma2_Lief ?? null, 30),
    firma3Lief: coerceStr(d.Firma3_Lief ?? null, 30),
    strasseLief: coerceStr(d.Strasse_Lief ?? null, 40),
    plzLief: coerceStr(d.PLZ_Lief ?? null, 8),
    ortLief: coerceStr(d.Ort_Lief ?? null, 40),
    plzLiefPostf: coerceStr(d.PLZ_Lief_Postf ?? null, 5),
    postfachLief: coerceStr(d.Postfach_Lief ?? null, 10),
    strassePost: coerceStr(d.Strasse_Post ?? null, 40),
    plzPost: coerceStr(d.PLZ_Post ?? null, 8),
    ortPost: coerceStr(d.Ort_Post ?? null, 40),
    benutzer: coerceStr(d.Benutzer ?? null, 250),
    bank1: coerceStr(d.Bank1 ?? null, 150),
    blz1: coerceStr(d.BLZ1 ?? null, 10),
    konto1: coerceStr(d.Konto1 ?? null, 15),
    bank2: coerceStr(d.Bank2 ?? null, 150),
    blz2: coerceStr(d.BLZ2 ?? null, 10),
    konto2: coerceStr(d.Konto2 ?? null, 15),
    bank3: coerceStr(d.Bank3 ?? null, 150),
    blz3: coerceStr(d.BLZ3 ?? null, 10),
    konto3: coerceStr(d.Konto3 ?? null, 15),
    kontaktart: coerceStr(d.Kontaktart ?? null, 30),
    kunde: coerceStr(d.Kunde ?? null, 6),
    lieferant: coerceStr(d.Lieferant ?? null, 6),
    interessent: coerceStr(d.Interessent ?? null, 6),
    andBenutzer: coerceStr(d.And_Benutzer ?? null, 250),
    andDatum: coerceDate(d.And_Datum ?? null),
    andZeit: coerceDate(d.And_Zeit ?? null),
    amBrief: coerceStr(d.Am_Brief ?? null, 6),
    funktion: coerceStr(d.Funktion ?? null, 80),
    geburtsdatum: coerceDate(d.Geburtsdatum ?? null),
    iniFile: coerceStr(d.IniFile ?? null, 30),
    benErfass: coerceStr(d.Ben_Erfass ?? null, 250),
    benAender: coerceStr(d.Ben_Aender ?? null, 250),
    benBemerk: coerceStr(d.Ben_Bemerk ?? null, 250),
    benKontakt: coerceStr(d.Ben_Kontakt ?? null, 250),
    aenderDat: coerceDate(d.Aender_Dat ?? null),
    zahlKont: coerceInt(d.Zahl_Kont ?? null),
    zahlWied: coerceInt(d.Zahl_Wied ?? null),
    zahlBem: coerceInt(d.Zahl_Bem ?? null),
    benWieder: coerceStr(d.Ben_Wieder ?? null, 250),
    nebenadresse: coerceInt(d.Nebenadresse ?? null),
    eintritt: coerceDate(d.Eintritt ?? null),
    austritt: coerceDate(d.Austritt ?? null),
    postzustb: coerceInt(d.Postzustb ?? null),
    bank: coerceStr(d.Bank ?? null, 40),
    blz: coerceStr(d.BLZ ?? null, 15),
    kontoNr: coerceStr(d.KontoNr ?? null, 15),
    telefon5: coerceStr(d.Telefon5 ?? null, 40),
    telefon6: coerceStr(d.Telefon6 ?? null, 40),
    telefon7: coerceStr(d.Telefon7 ?? null, 40),
    landname: coerceStr(d.Landname ?? null, 30),
    landKurzel: coerceStr(d.LandKurzel ?? null, 4),
    finanzamtNr: coerceInt(d.FinanzamtNr ?? null),
    bezirkNr: coerceInt(d.BezirkNr ?? null),
    unterPrfNr: coerceInt(d.Unter_Prf_Nr ?? null),
    mahnSperre: coerceStr(d.MahnSperre ?? null, 4),
    lastschrift: coerceStr(d.Lastschrift ?? null, 4),
    lieferNr: coerceStr(d.LieferNr ?? null, 20),
    egKennNr: coerceStr(d.EG_KennNr ?? null, 16),
    zahlSpere: coerceStr(d.Zahl_Spere ?? null, 4),
    fibuNr: coerceInt(d.FibuNr ?? null),
    mandant: coerceStr(d.Mandant ?? null, 6),
    lastschrDat: coerceDate(d.LastschrDat ?? null),
    zahlungsart: coerceStr(d.Zahlungsart ?? null, 20),
    zahlungsweise: coerceStr(d.Zahlungsweise ?? null, 20),
    debitorkto: coerceInt(d.DEBITORKTO ?? null),
    kreditorkto: coerceInt(d.KREDITORKTO ?? null),
    mitglnr: coerceStr(d.MITGLNR ?? null, 15),
    jahr: coerceInt(d.Jahr ?? null),
    serienbrief: coerceStr(d.Serienbrief ?? null, 5),
    mitglNrN: coerceInt(d.MitglNrN ?? null),
    aktiv: coerceStr(d.Aktiv ?? null, 1),
    abwKontoInh: coerceStr(d.AbwKontoInh ?? null, 50),
    checkBox1: coerceStr(d.CheckBox1 ?? null, 1),
    checkBox2: coerceStr(d.CheckBox2 ?? null, 1),
    checkBox3: coerceStr(d.CheckBox3 ?? null, 1),
    bereich: coerceStr(d.Bereich ?? null, 1),
    buero: coerceStr(d.Buero ?? null, 80),
    altBuero: coerceStr(d.AltBuero ?? null, 80),
    bueroDatum: coerceDate(d.BueroDatum ?? null),
    kreditkarte: coerceStr(d.Kreditkarte ?? null, 1),
    kreditkartenhalter: coerceStr(d.Kreditkartenhalter ?? null, 80),
    kreditkartennummer: coerceStr(d.Kreditkartennummer ?? null, 20),
    verfallsdatum: coerceDate(d.Verfallsdatum ?? null),
    kreditkartenname: coerceStr(d.Kreditkartenname ?? null, 80),
    statecode: coerceStr(d.STATECODE ?? null, 20),
    semOrt: coerceStr(d.SemORT ?? null, 1),
    referent: coerceStr(d.Referent ?? null, 1),
    semHotel: coerceStr(d.SemHotel ?? null, 1),
    aktivPasiv: coerceStr(d.AktivPasiv ?? null, 1),
    postfach: coerceInt(d.Postfach ?? null),
    telefon3: coerceStr(d.Telefon3 ?? null, 240),
    abteilung: coerceStr(d.Abteilung ?? null, 80),
    kennung1: coerceStr(d.Kennung1 ?? null, 80),
    kennung2: coerceStr(d.Kennung2 ?? null, 80),
    kennung3: coerceStr(d.Kennung3 ?? null, 80),
    kennung3Neu: coerceStr(d.Kennung3Neu ?? null, 80),
    mitglied: coerceStr(d.Mitglied ?? null, 60),
    attribut1: coerceStr(d.Attribut1 ?? null, 1),
    attribut2: coerceStr(d.Attribut2 ?? null, 1),
    attribut3: coerceStr(d.Attribut3 ?? null, 1),
    geborene: coerceStr(d.Geborene ?? null, 50),
    genannt: coerceStr(d.Genannt ?? null, 80),
    namensvorsatz: coerceStr(d.Namensvorsatz ?? null, 80),
    namenszusatz: coerceStr(d.Namenszusatz ?? null, 80),
    verstorbenAm: coerceDate(d.VerstorbenAm ?? null),
    hauptKennung: coerceStr(d.HauptKennung ?? null, 60),
    titel1: coerceStr(d.Titel1 ?? null, 60),
    titel2: coerceStr(d.Titel2 ?? null, 60),
    spendeKennung: coerceStr(d.SpendeKennung ?? null, 60),
    checkBox4: coerceStr(d.CheckBox4 ?? null, 1),
    checkBox5: coerceStr(d.CheckBox5 ?? null, 1),
    checkBox6: coerceStr(d.CheckBox6 ?? null, 1),
    checkBox7: coerceStr(d.CheckBox7 ?? null, 1),
    checkBox8: coerceStr(d.CheckBox8 ?? null, 1),
    checkBox9: coerceStr(d.CheckBox9 ?? null, 1),
    checkBox10: coerceStr(d.CheckBox10 ?? null, 1),
    geburtsort: coerceStr(d.Geburtsort ?? null, 60),
    eMailName: coerceStr(d.EMailName ?? null, 250) ?? coerceStr(d.Telefon3 ?? null, 250),
    rabatP: coerceDecimal(d.RabatP ?? null),
    rabatB: coerceDecimal(d.RabatB ?? null),
    mw: coerceStr(d.MW ?? null, 1),
    buero2: coerceStr(d.Buero2 ?? null, 80),
    konto4: coerceStr(d.Konto4 ?? null, 15),
    blz4: coerceStr(d.BLZ4 ?? null, 15),
    bank4: coerceStr(d.Bank4 ?? null, 40),
    konto5: coerceStr(d.Konto5 ?? null, 15),
    blz5: coerceStr(d.BLZ5 ?? null, 15),
    bank5: coerceStr(d.Bank5 ?? null, 40),
    konto6: coerceStr(d.Konto6 ?? null, 15),
    blz6: coerceStr(d.BLZ6 ?? null, 15),
    bank6: coerceStr(d.Bank6 ?? null, 40),
    dauerSpender: coerceStr(d.DauerSpender ?? null, 1),
    adrNrM: coerceInt(d.AdrNr_M ?? null),
    kriteriumHb: coerceStr(d.KriteriumHB ?? null, 60),
    bundesland: coerceStr(d.Bundesland ?? null, 5),
    bild: coerceStr(d.Bild ?? null, 160),
    haus: coerceStr(d.Haus ?? null, 1),
    land: coerceStr(d.Land ?? null, 100),
    co: coerceStr(d.co ?? null, 120),
    landesverband: coerceStr(d.Landesverband ?? null, 5),
    kartenNr1: coerceStr(d.KartenNr1 ?? null, 60),
    kartenNr2: coerceStr(d.KartenNr2 ?? null, 60),
    maxKont: coerceInt(d.MaxKont ?? null),
    versandart: coerceStr(d.Versandart ?? null, 60),
    gesperrt: coerceStr(d.gesperrt ?? null, 1),
    spender: coerceStr(d.Spender ?? null, 1),
    bezirk: coerceStr(d.Bezirk ?? null, 50),
    stadtteil: coerceStr(d.Stadtteil ?? null, 50),
    iban1: coerceStr(d.IBAN1 ?? null, 40),
    iban1Last4: lastFour(coerceStr(d.IBAN1 ?? null, 40)),
    iban2: coerceStr(d.IBAN2 ?? null, 40),
    iban3: coerceStr(d.IBAN3 ?? null, 40),
    bic1: coerceStr(d.BIC1 ?? null, 40),
    bic2: coerceStr(d.BIC2 ?? null, 40),
    bic3: coerceStr(d.BIC3 ?? null, 40),
    vorwahl2: coerceStr(d.Vorwahl2 ?? null, 10),
    vorwahl3: coerceStr(d.Vorwahl3 ?? null, 10),
    vorwahl4: coerceStr(d.Vorwahl4 ?? null, 10),
    dtOfSgntr: coerceDate(d.DtOfSgntr ?? null),
    sepaFe: coerceStr(d.SEPA_FE ?? null, 1),
    adrNrKih: coerceInt(d.AdrNrKIH ?? null),
    // Linear has a typo: column is `mandatsrefenz` (single 'r'); some exports
    // also include the corrected spelling. Prefer the typo'd column.
    mandatsrefenz:
      coerceStr(d.mandatsrefenz ?? null, 35) ?? coerceStr(d.Mandatsreferenz ?? null, 35),
    dsaKennziffer: coerceStr(d.DSAKennziffer ?? null, 30),
    dsaMitglNr: coerceStr(d.DSAMitglNr ?? null, 30),
    hausnummer: coerceStr(d.Hausnummer ?? null, 10),
    ausweisnummer: coerceStr(d.Ausweisnummer ?? null, 20),
    gueltigkeitsdatum: coerceDate(d.Gueltigkeitsdatum ?? null),
    dsaVerband: coerceStr(d.DSAVerband ?? null, 250),
    dsaSportArt: coerceStr(d.DSASportArt ?? null, 4),
    dsaSmk: coerceStr(d.DSA_SMK ?? null, 1),
    dsaSvk: coerceStr(d.DSA_SVK ?? null, 1),
    dsaBeantragt: coerceStr(d.DSABeantragt ?? null, 1),
    einzugLastMandLiegtVor: coerceStr(d.EinzugLastMandLiegtVor ?? null, 1),
    strasseKih: coerceStr(d.StrasseKIH ?? null, 40),
    plzKih: coerceStr(d.PlzKIH ?? null, 15),
    ortKih: coerceStr(d.OrtKIH ?? null, 40),
    emailKih: coerceStr(d.EmailKIH ?? null, 250),
    abwKtoInhCb: coerceStr(d.AbwKtoInhCB ?? null, 1),
    abwAnrAnsch: coerceStr(d.AbwAnrAnsch ?? null, 40),
    adresszusatz: coerceStr(d.Adresszusatz ?? null, 50),
    briefempfanger: coerceStr(d.Briefempfanger ?? null, 1),
    briefanredeS: coerceStr(d.BriefanredeS ?? null, 255),
    blsvMeldung: coerceDate(d.BLSVMeldung ?? null),
    www: coerceStr(d.www ?? null, 256),
    einverstandnisDatenverarbeitung: coerceStr(d.EinverstandnisDatenverarbeitung ?? null, 1),
    veroffentlichungBildUndName: coerceStr(d.VeroffentlichungBildUndName ?? null, 1),
    geburtsname: coerceStr(d.Geburtsname ?? null, 80),
    vertBem: coerceStr(d.VertBem ?? null),
    postAnschriftPostfachStrasse: coerceStr(d.PostAnschriftPostfachStrasse ?? null, 100),
    postAnschriftPostfachPlz: coerceStr(d.PostAnschriftPostfachPlz ?? null, 100),
    postAnschriftPostfachOrt: coerceStr(d.PostAnschriftPostfachOrt ?? null, 100),
    postAnschriftPostfach: coerceStr(d.PostAnschriftPostfach ?? null, 100),
    postAnschriftMemo1: coerceStr(d.PostAnschriftMemo1 ?? null),
    postAnschriftStrasse: coerceStr(d.PostAnschriftStrasse ?? null, 100),
    postAnschriftPlz: coerceStr(d.PostAnschriftPlz ?? null, 100),
    postAnschriftOrt: coerceStr(d.PostAnschriftOrt ?? null, 100),
    postAnschriftLand: coerceStr(d.PostAnschriftLand ?? null, 100),
    postAnschriftMemo2: coerceStr(d.PostAnschriftMemo2 ?? null),
    berufsGruppe: coerceStr(d.BerufsGruppe ?? null, 100),
    einverstandisDatenverarbeitung: coerceStr(d.EinverstandisDatenverarbeitung ?? null, 1),
    geloscht: coerceBool(d.Geloscht ?? null),
    freeBit1: coerceBool(d.FreeBit1 ?? null),
    freeBit2: coerceBool(d.FreeBit2 ?? null),
    freeText1: coerceStr(d.FreeText1 ?? null, 200),
    freeText2: coerceStr(d.FreeText2 ?? null, 200),
    freeText3: coerceStr(d.FreeText3 ?? null, 200),
    freeText4: coerceStr(d.FreeText4 ?? null, 200),
    lastImportedAt: new Date(),
  };
  return m;
}

function _yn(value: Cell): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toUpperCase();
  if (s === "Y" || s === "J" || s === "1") return true;
  if (s === "N" || s === "0" || s === "") return false;
  return null;
}

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
    strasseKih: coerceStr(d.StrasseKIH ?? null, 40),
    plzKih: coerceStr(d.PlzKIH ?? null, 15),
    ortKih: coerceStr(d.OrtKIH ?? null, 40),
    emailKih: coerceStr(d.EmailKIH ?? null, 250),
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
    fax: coerceStr(d.Fax ?? null, 40),
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
