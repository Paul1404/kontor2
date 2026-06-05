/**
 * Linear `adresse` row -> clean member shape. This is the anti-corruption
 * boundary: Linear's 247-column shape and its flag quirks stop here, and the
 * rest of the app sees only the clean domain fields from `~/server/domain/member`.
 *
 * The verbatim Linear row is preserved separately (see `member_source_records`),
 * so dropping a legacy column from the working schema never loses data.
 *
 * Not yet wired into the ingest pipeline -- that happens in a later phase. For
 * now this is a pure, tested function that the backfill and the pipeline will
 * both call, so the live import path and the one-time backfill cannot diverge.
 */

import { lastFour } from "~/server/crypto/encrypt";
import { type CleanMemberInput, deriveStatus, isDunningBlocked } from "~/server/domain/member";
import type { LinearRow } from "~/server/importer/linear-mapper";
import { coerceBool, coerceDate, coerceInt, coerceStr } from "~/server/importer/sql-tokenizer";

/**
 * Translate one Linear `adresse` row into the clean member shape. Returns null
 * when the row has no `AdrNr` (the upsert key), matching `mapMemberRow`.
 */
export function translateLinearMember(d: LinearRow): CleanMemberInput | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  if (adrNr === null) return null;

  const iban1 = coerceStr(d.IBAN1 ?? null, 40);

  return {
    adrNr,
    mitgliedsnummer: coerceStr(d.MITGLNR ?? null, 15),
    // Name
    anrede: coerceStr(d.Anrede ?? null, 20),
    titel1: coerceStr(d.Titel1 ?? null, 60),
    titel2: coerceStr(d.Titel2 ?? null, 60),
    vorname: coerceStr(d.Vorname ?? null, 30),
    nachname: coerceStr(d.Nachname ?? null, 40),
    geborene: coerceStr(d.Geborene ?? null, 50),
    geburtsname: coerceStr(d.Geburtsname ?? null, 80),
    genannt: coerceStr(d.Genannt ?? null, 80),
    namensvorsatz: coerceStr(d.Namensvorsatz ?? null, 80),
    namenszusatz: coerceStr(d.Namenszusatz ?? null, 80),
    geburtsdatum: coerceDate(d.Geburtsdatum ?? null),
    geburtsort: coerceStr(d.Geburtsort ?? null, 60),
    // Address
    strasse: coerceStr(d.Strasse ?? null, 50),
    hausnummer: coerceStr(d.Hausnummer ?? null, 10),
    adresszusatz: coerceStr(d.Adresszusatz ?? null, 50),
    plz: coerceStr(d.PLZ ?? null, 15),
    ort: coerceStr(d.Ort ?? null, 40),
    land: coerceStr(d.Land ?? null, 100),
    // Contact. Linear sometimes stored the email in Telefon3, so keep the same
    // fallback the legacy mapper used.
    email: coerceStr(d.EMailName ?? null, 250) ?? coerceStr(d.Telefon3 ?? null, 250),
    telefon1: coerceStr(d.Telefon1 ?? null, 40),
    telefon2: coerceStr(d.Telefon2 ?? null, 40),
    telefon3: coerceStr(d.Telefon3 ?? null, 240),
    www: coerceStr(d.www ?? null, 256),
    fax: coerceStr(d.Fax ?? null, 40),
    // Organisation / role
    firma1: coerceStr(d.Firma1 ?? null, 40),
    firma2: coerceStr(d.Firma2 ?? null, 40),
    firma3: coerceStr(d.Firma3 ?? null, 40),
    firma4: coerceStr(d.Firma4 ?? null, 100),
    kurzname: coerceStr(d.Kurzname ?? null, 40),
    funktion: coerceStr(d.Funktion ?? null, 80),
    abteilung: coerceStr(d.Abteilung ?? null, 80),
    spender: coerceStr(d.Spender ?? null, 1),
    // Status (normalized)
    status: deriveStatus({
      austritt: coerceDate(d.Austritt ?? null),
      verstorbenAm: coerceDate(d.VerstorbenAm ?? null),
      aktivPasiv: coerceStr(d.AktivPasiv ?? null, 1),
    }),
    dunningBlocked: isDunningBlocked(coerceStr(d.MahnSperre ?? null, 4)),
    eintritt: coerceDate(d.Eintritt ?? null),
    austritt: coerceDate(d.Austritt ?? null),
    verstorbenAm: coerceDate(d.VerstorbenAm ?? null),
    isDeleted: coerceBool(d.Geloscht ?? null) === true,
    // Banking / SEPA
    iban1,
    iban1Last4: lastFour(iban1),
    bic1: coerceStr(d.BIC1 ?? null, 40),
    // Linear has a typo'd column `mandatsrefenz`; prefer it, fall back to the
    // corrected spelling some exports use.
    mandatsreferenz:
      coerceStr(d.mandatsrefenz ?? null, 35) ?? coerceStr(d.Mandatsreferenz ?? null, 35),
    abwKontoInh: coerceStr(d.AbwKontoInh ?? null, 50),
    // Abweichender Kontoinhaber (KIH)
    strasseKih: coerceStr(d.StrasseKIH ?? null, 40),
    plzKih: coerceStr(d.PlzKIH ?? null, 15),
    ortKih: coerceStr(d.OrtKIH ?? null, 40),
    emailKih: coerceStr(d.EmailKIH ?? null, 250),
    adrNrKih: coerceInt(d.AdrNrKIH ?? null),
  };
}
