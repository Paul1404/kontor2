/**
 * Linear `adresse` row -> clean member row. This is the anti-corruption
 * boundary: Linear's legacy shape and its flag quirks stop here, and the
 * importer writes only the clean domain columns (`~/server/domain/member`).
 * The verbatim Linear row is preserved separately in `member_source_records`,
 * so nothing is lost.
 */

import { lastFour } from "~/server/crypto/encrypt";
import { type CleanMemberInput, deriveStatus, isDunningBlocked } from "~/server/domain/member";
import type { LinearRow } from "~/server/importer/linear-mapper";
import { coerceBool, coerceDate, coerceInt, coerceStr } from "~/server/importer/sql-tokenizer";
import { normalizePhone, titleCaseName } from "~/server/validation/member-fields";

/**
 * Translate one Linear `adresse` row into the clean member row. Returns null
 * when the row has no `AdrNr` (the upsert key).
 */
export function translateLinearMember(d: LinearRow): CleanMemberInput | null {
  const adrNr = coerceInt(d.AdrNr ?? null);
  if (adrNr === null) return null;

  const iban1 = coerceStr(d.IBAN1 ?? null, 40);
  const austritt = coerceDate(d.Austritt ?? null);
  const verstorbenAm = coerceDate(d.VerstorbenAm ?? null);

  return {
    adrNr,
    mitgliedsnummer: coerceStr(d.MITGLNR ?? null, 15),
    anrede: coerceStr(d.Anrede ?? null, 20),
    titel1: coerceStr(d.Titel1 ?? null, 60),
    // Normalize names on write (issue #80): title-case only re-cases
    // all-upper/all-lower tokens, so Linear's frequent ALL-CAPS surnames become
    // "Müller" while a deliberate "McDonald" is left as-is.
    vorname: titleCaseName(coerceStr(d.Vorname ?? null, 30)),
    nachname: titleCaseName(coerceStr(d.Nachname ?? null, 40)),
    geburtsdatum: coerceDate(d.Geburtsdatum ?? null),
    geburtsort: coerceStr(d.Geburtsort ?? null, 60),
    kurzname: coerceStr(d.Kurzname ?? null, 40),
    firma1: coerceStr(d.Firma1 ?? null, 40),
    funktion: coerceStr(d.Funktion ?? null, 80),
    spender: coerceStr(d.Spender ?? null, 1),
    strasse: coerceStr(d.Strasse ?? null, 50),
    hausnummer: coerceStr(d.Hausnummer ?? null, 10),
    adresszusatz: coerceStr(d.Adresszusatz ?? null, 50),
    plz: coerceStr(d.PLZ ?? null, 15),
    ort: coerceStr(d.Ort ?? null, 40),
    land: coerceStr(d.Land ?? null, 100),
    // Linear sometimes stored the email in Telefon3; keep that fallback.
    email: coerceStr(d.EMailName ?? null, 250) ?? coerceStr(d.Telefon3 ?? null, 250),
    // Coerce an area-code-only phone (no subscriber part) to null on import.
    telefon1: normalizePhone(coerceStr(d.Telefon1 ?? null, 40)),
    telefon2: normalizePhone(coerceStr(d.Telefon2 ?? null, 40)),
    www: coerceStr(d.www ?? null, 256),
    iban1,
    iban1Last4: lastFour(iban1),
    bic1: coerceStr(d.BIC1 ?? null, 40),
    abwKontoInh: coerceStr(d.AbwKontoInh ?? null, 50),
    eintritt: coerceDate(d.Eintritt ?? null),
    austritt,
    verstorbenAm,
    status: deriveStatus({ austritt, verstorbenAm }),
    dunningBlocked: isDunningBlocked(coerceStr(d.MahnSperre ?? null, 4)),
    abteilung: coerceStr(d.Abteilung ?? null, 80),
    isDeleted: coerceBool(d.Geloscht ?? null) === true,
  };
}
