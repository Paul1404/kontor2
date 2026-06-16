import { ORPCError } from "@orpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import type { DB } from "~/server/db/client";
import { dataQualityExceptionsTable } from "~/server/db/schema/data-quality-exceptions";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { type CsvColumn, toCsv } from "~/server/lib/csv";
import { buildDataQualityWorkbook } from "~/server/lib/xlsx-data-quality";
import { vorstandProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

/**
 * Datenqualität: surfaces actionable data problems in the member base so the
 * 200-column Linear mirror stays trustworthy. Every check is a pure read over
 * existing tables (no migration); each is expressed as a single SQL WHERE
 * clause over `members` so the summary can count all of them in one round trip
 * and the drill-down can list the affected rows with the same clause.
 *
 * The clauses contain no user input -- the `category` input is validated
 * against the fixed `CATEGORY_IDS` picklist -- so composing them with
 * `sql.raw` is safe.
 */

export const CATEGORY_IDS = [
  "lastschrift_ohne_mandat",
  "fehlende_iban",
  "fehlende_adresse",
  "name_fehlt",
  "aktiv_ohne_vertrag",
  "minderjaehrig_ohne_vertretung",
  "geburtsdatum_unplausibel",
  "eintritt_nach_austritt",
  "austritt_offene_vertraege",
  "fehlende_email",
  "email_ungueltig",
  "email_mehrfach",
  "plz_ungueltig",
  "geschlecht_unbekannt",
  "vertrag_ohne_beitragsart",
  "mahnsperre_gesetzt",
  "moegliche_dubletten",
  // --- v0.55 additions (issue #79) ---------------------------------------
  "telefon_nur_vorwahl",
  "mitgliedsnummer_kollision",
  "name_reihenfolge_vertauscht",
  "mehrere_personen_im_datensatz",
  "strasse_ohne_hausnummer",
  "vertrag_betrag_null",
  "dublette_name_ohne_gebdatum",
  // --- issue #230: Tarif/Alter-Abgleich -----------------------------------
  "tarif_passt_nicht_zum_alter",
  "volljaehrig_eltern_konto",
  // --- cloned-from-child import artifact (wrong birthdate on parent) -------
  "beziehung_gleiches_geburtsdatum",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type CategoryMeta = {
  id: CategoryId;
  /** Short German label for the issue. */
  label: string;
  /** One-sentence explanation of what the check finds and why it matters. */
  description: string;
  /**
   * "error" = a hard data fault that breaks a process (an expired mandate
   * blocks the Einzug, a duplicate Mitgliedsnummer breaks identity); "warn" =
   * should be fixed; "info" = worth a look. Drives the UI accent.
   */
  severity: "error" | "warn" | "info";
};

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "lastschrift_ohne_mandat",
    label: "Lastschrift ohne SEPA-Mandat",
    description:
      "Beitragspflichtiger Lastschrift-Vertrag (über 0 €), aber weder das Mitglied noch sein Zahler (Familie oder Vertreter) hat ein SEPA-Mandat. Ein Einzug ist so nicht möglich.",
    severity: "error",
  },
  {
    id: "fehlende_iban",
    label: "Lastschrift ohne IBAN",
    description:
      "Beitragspflichtiger Lastschrift-Vertrag (über 0 €), aber weder das Mitglied noch sein Zahler hat eine IBAN hinterlegt. Der Beitrag kann nicht eingezogen werden.",
    severity: "warn",
  },
  {
    id: "fehlende_adresse",
    label: "Unvollständige Anschrift",
    description: "Aktive Mitglieder ohne Straße, PLZ oder Ort. Postversand ist nicht möglich.",
    severity: "warn",
  },
  {
    id: "name_fehlt",
    label: "Kein Name hinterlegt",
    description:
      "Aktive Mitglieder ohne Nachname, Firma oder Kurzname. Der Datensatz lässt sich kaum zuordnen.",
    severity: "warn",
  },
  {
    id: "aktiv_ohne_vertrag",
    label: "Mitglied ohne Vertrag",
    description:
      "Aktive Mitglieder ohne einen laufenden Vertrag. Für sie wird kein Beitrag gestellt.",
    severity: "warn",
  },
  {
    id: "minderjaehrig_ohne_vertretung",
    label: "Minderjährig ohne Vertretung",
    description:
      "Mitglieder unter 18 ohne gesetzliche Vertretung. Schreiben gehen sonst direkt an das Kind.",
    severity: "warn",
  },
  {
    id: "geburtsdatum_unplausibel",
    label: "Geburtsdatum unplausibel",
    description:
      "Geburtsdatum liegt in der Zukunft oder ergibt ein Alter über 110 Jahre. Vermutlich ein Tippfehler.",
    severity: "warn",
  },
  {
    id: "eintritt_nach_austritt",
    label: "Austritt vor Eintritt",
    description: "Das Austrittsdatum liegt vor dem Eintrittsdatum. Die Daten widersprechen sich.",
    severity: "warn",
  },
  {
    id: "austritt_offene_vertraege",
    label: "Austritt mit offenem Vertrag",
    description:
      "Ausgetretene Mitglieder, deren Vertrag weder gekündigt noch beendet ist. Der Austritt ist nicht sauber abgeschlossen.",
    severity: "warn",
  },
  {
    id: "fehlende_email",
    label: "Keine E-Mail-Adresse",
    description: "Aktive Mitglieder ohne E-Mail. Sie sind nur per Post erreichbar.",
    severity: "info",
  },
  {
    id: "email_ungueltig",
    label: "E-Mail unplausibel",
    description:
      "Hinterlegte E-Mail ohne erkennbares Format (kein @ oder keine Domain). Zustellung schlägt fehl.",
    severity: "info",
  },
  {
    id: "email_mehrfach",
    label: "E-Mail mehrfach vergeben",
    description:
      "Dieselbe E-Mail liegt bei mehreren Mitgliedern. Oft eine Familienadresse, manchmal eine Dublette.",
    severity: "info",
  },
  {
    id: "plz_ungueltig",
    label: "PLZ unplausibel",
    description: "Inländische Postleitzahl, die nicht aus genau fünf Ziffern besteht.",
    severity: "info",
  },
  {
    id: "geschlecht_unbekannt",
    label: "Geschlecht nicht bestimmbar",
    description:
      "Aktive Mitglieder ohne Geschlecht, bei denen auch die Anrede keinen Hinweis gibt. Anrede oder Geschlecht pflegen.",
    severity: "info",
  },
  {
    id: "vertrag_ohne_beitragsart",
    label: "Vertrag ohne Beitragsart",
    description:
      "Aktive Mitglieder mit einem Vertrag ohne hinterlegte Bezeichnung der Beitragsart.",
    severity: "info",
  },
  {
    id: "mahnsperre_gesetzt",
    label: "Mahnsperre gesetzt",
    description:
      "Aktive Mitglieder, die vom Mahnlauf ausgenommen sind. Gelegentlich prüfen, ob die Sperre noch gewollt ist.",
    severity: "info",
  },
  {
    id: "moegliche_dubletten",
    label: "Mögliche Dubletten",
    description:
      "Mehrere Datensätze mit gleichem Namen und Geburtsdatum. Eventuell ist jemand doppelt erfasst.",
    severity: "info",
  },
  {
    id: "telefon_nur_vorwahl",
    label: "Telefon nur Vorwahl",
    description:
      "Telefonnummer enthält nach Entfernen der Sonderzeichen nur eine Vorwahl ohne Anschluss. So ist niemand erreichbar.",
    severity: "warn",
  },
  {
    id: "mitgliedsnummer_kollision",
    label: "Mitgliedsnummer doppelt vergeben",
    description:
      "Dieselbe Mitgliedsnummer liegt auf mehr als einem aktiven Datensatz. Die Nummer identifiziert dann niemanden eindeutig.",
    severity: "error",
  },
  {
    id: "name_reihenfolge_vertauscht",
    label: "Vor- und Nachname vertauscht",
    description:
      "Im Nachnamenfeld steht ein häufiger Vorname, im Vornamenfeld nicht. Vermutlich sind die Felder vertauscht.",
    severity: "warn",
  },
  {
    id: "mehrere_personen_im_datensatz",
    label: "Mehrere Personen in einem Datensatz",
    description:
      "Name enthält ein Verbindungswort (u., und, &). Vermutlich sind zwei Personen in einen Datensatz gepackt.",
    severity: "warn",
  },
  {
    id: "strasse_ohne_hausnummer",
    label: "Straße ohne Hausnummer",
    description:
      "Die Straße enthält keine Ziffer und es ist keine Hausnummer hinterlegt. Der Postversand kann scheitern.",
    severity: "info",
  },
  {
    id: "vertrag_betrag_null",
    label: "Vertrag mit Betrag 0",
    description:
      "Vertrag mit Betrag 0 bei einem nicht beitragsbefreiten Mitglied. Oft ein Tippfehler statt einer echten Befreiung.",
    severity: "info",
  },
  {
    id: "dublette_name_ohne_gebdatum",
    label: "Mögliche Dublette ohne Geburtsdatum",
    description:
      "Gleicher Name auf mehreren Datensätzen, von denen mindestens einer kein Geburtsdatum hat. Die Geburtsdatums-Dublettenprüfung übersieht diese.",
    severity: "info",
  },
  {
    id: "tarif_passt_nicht_zum_alter",
    label: "Beitragsart passt nicht zum Alter",
    description:
      "Laufender Vertrag, dessen Beitragsart eine Altersgrenze hat, in die das Mitglied nicht mehr passt (z. B. 18-Jährige noch im Jugendtarif). Die Altersgrenzen werden je Beitragsart gepflegt; Beitragsarten ohne Altersgrenze werden nicht geprüft.",
    severity: "warn",
  },
  {
    id: "volljaehrig_eltern_konto",
    label: "Volljährig auf Eltern-Konto",
    description:
      "Aktives Mitglied ab 18 Jahren, dessen Lastschrift weiter über das Konto eines Zahlers (Elternteil) läuft. Erkannt über eine formale Zahler-Verknüpfung oder, bei Altdaten ohne Verknüpfung, heuristisch über einen abweichenden Kontoinhaber oder eine IBAN, die sich mit einem älteren Mitglied gleichen Nachnamens deckt. Erinnerung zur Umstellung auf Selbstzahler. Es wird nichts automatisch geändert.",
    severity: "info",
  },
  {
    id: "beziehung_gleiches_geburtsdatum",
    label: "Gleiches Geburtsdatum wie Beziehungspartner",
    description:
      "Ein verknüpftes Mitglied trägt dasselbe Geburtsdatum wie sein Beziehungspartner mit anderem Namen. Bei Eltern und Kind ist das praktisch unmöglich und stammt meist aus dem Import, der den Eltern-Satz vom Kind übernommen hat. Das falsche Datum verfälscht Mahnwesen, Altersgrenzen und Bestandserhebung. Bitte prüfen, welcher Datensatz das richtige Geburtsdatum braucht.",
    severity: "warn",
  },
];

/** A live member: not soft-deleted, neither exited nor deceased. */
const ACTIVE = "deleted_at is null and austritt is null and verstorben_am is null";

/** Active direct-debit contract that is not cancelled or expired. */
const ACTIVE_DD =
  "exists (select 1 from contracts c where c.member_id = members.id and c.is_direct_debit = true " +
  "and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date))";

/**
 * Active direct-debit contract with something to actually collect (betrag > 0).
 * A 0-Euro or beitragsfrei contract flagged as direct debit is noise -- there is
 * nothing to debit, so it must not raise a "missing mandate / IBAN" flag.
 */
const ACTIVE_DD_POS =
  "exists (select 1 from contracts c where c.member_id = members.id and c.is_direct_debit = true " +
  "and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date) and c.betrag > 0)";

/**
 * Resolved payer (Zahler) of a direct-debit contract `c`, as a scalar member
 * id, mirroring `resolveZahler`: the explicit per-contract Zahler -> the active
 * family payer (kind role) -> the Vertreter (minors only) -> the billed member.
 * Lets the mandate/IBAN checks follow who actually pays instead of flagging a
 * child whose parent/family holds the mandate.
 */
const FAMILIE_ZAHLER =
  "(select fam.zahler_member_id from familien_mitglieder fm join familien fam on fam.id = fm.familie_id " +
  "where fm.member_id = members.id and fm.bis is null and fm.rolle = 'kind' limit 1)";
const VERTRETER =
  "(select r.to_member_id from relationships r where r.from_member_id = members.id and r.ist_vertreter = true " +
  "and members.geburtsdatum is not null and members.geburtsdatum > current_date - interval '18 years' limit 1)";
/** Payer of contract `c` (correlated to outer `members`). */
const PAYER_FOR_C = `coalesce(c.zahler_member_id, ${FAMILIE_ZAHLER}, ${VERTRETER}, members.id)`;
/** Active direct-debit contract `c` with an amount to collect. */
const DD_CONTRACT_C =
  "c.member_id = members.id and c.is_direct_debit = true and c.gekuend_zum is null " +
  "and (c.vertrag_ende is null or c.vertrag_ende >= current_date) and c.betrag > 0";

/**
 * Heuristik (#236): ein abweichender Kontoinhaber ist hinterlegt, dessen
 * Freitext nicht den Vornamen des Mitglieds enthält. "Abweichender
 * Kontoinhaber" heißt per Definition, dass das Konto jemand anderem gehört;
 * fehlt darin der eigene Vorname, zahlt mutmaßlich ein Elternteil. Auf den
 * Vornamen statt den Nachnamen geprüft, weil ein Elternteil meist denselben
 * Nachnamen trägt, aber einen anderen Vornamen.
 */
const ABW_KONTOINH_FREMD =
  "coalesce(btrim(members.abw_konto_inh), '') <> '' " +
  "and coalesce(btrim(members.vorname), '') <> '' " +
  "and position(lower(btrim(members.vorname)) in lower(members.abw_konto_inh)) = 0";

/**
 * Heuristik (#236): die IBAN-Endung des Mitglieds taucht bei einem älteren
 * Mitglied mit gleichem Nachnamen wieder auf -- klassisch das Konto eines
 * Elternteils. Nur die letzten vier Stellen sind abfragbar (die volle IBAN ist
 * verschlüsselt), daher zusätzlich gleicher Nachname, um zufällige
 * Endungs-Kollisionen zwischen Fremden auszuschließen.
 */
const IBAN_GETEILT_MIT_AELTEREM =
  "coalesce(btrim(members.iban1_last4), '') <> '' " +
  "and coalesce(btrim(members.nachname), '') <> '' " +
  "and exists (select 1 from members o where o.id <> members.id and o.deleted_at is null " +
  "and o.iban1_last4 = members.iban1_last4 " +
  "and lower(btrim(coalesce(o.nachname, ''))) = lower(btrim(coalesce(members.nachname, ''))) " +
  "and o.geburtsdatum is not null and (members.geburtsdatum is null or o.geburtsdatum < members.geburtsdatum))";

/** Any contract that is currently in force (not cancelled, not expired). */
const ACTIVE_CONTRACT =
  "exists (select 1 from contracts c where c.member_id = members.id " +
  "and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date))";

/**
 * Anrede that maps to a gender, mirroring `deriveGeschlecht`. Used to decide
 * when "Geschlecht nicht bestimmbar" is genuinely unfixable from the Anrede.
 */
const ANREDE_HAS_GENDER =
  "(lower(btrim(coalesce(anrede, ''))) in ('herr','hr','hr.','herrn','frau','fr','fr.','divers') " +
  "or lower(btrim(coalesce(anrede, ''))) like 'herr %' or lower(btrim(coalesce(anrede, ''))) like 'frau %')";

/**
 * WHERE clause per category. No user input -- safe to compose with sql.raw.
 * Exported so the nightly snapshot writer (issue #81) can reuse the exact same
 * clauses for counts and for the error-rule drill-down.
 */
export const WHERE: Record<CategoryId, string> = {
  lastschrift_ohne_mandat: `${ACTIVE} and exists (select 1 from contracts c where ${DD_CONTRACT_C} and not exists (select 1 from sepa_mandates s where s.member_id = (${PAYER_FOR_C}) and coalesce(s.is_deleted, false) = false and s.widerrufen_am is null))`,
  fehlende_iban: `${ACTIVE} and exists (select 1 from contracts c where ${DD_CONTRACT_C} and not exists (select 1 from members p where p.id = (${PAYER_FOR_C}) and p.iban1_last4 is not null and btrim(p.iban1_last4) <> ''))`,
  fehlende_adresse: `${ACTIVE} and (strasse is null or btrim(strasse) = '' or plz is null or btrim(plz) = '' or ort is null or btrim(ort) = '')`,
  name_fehlt: `${ACTIVE} and coalesce(btrim(nachname), '') = '' and coalesce(btrim(firma1), '') = '' and coalesce(btrim(kurzname), '') = ''`,
  aktiv_ohne_vertrag: `${ACTIVE} and member_no is not null and not ${ACTIVE_CONTRACT}`,
  minderjaehrig_ohne_vertretung: `${ACTIVE} and geburtsdatum is not null and geburtsdatum > (current_date - interval '18 years') and (vertreter_name is null or btrim(vertreter_name) = '') and not exists (select 1 from relationships r where r.from_member_id = members.id and r.ist_vertreter = true)`,
  geburtsdatum_unplausibel: `deleted_at is null and geburtsdatum is not null and (geburtsdatum > current_date or geburtsdatum < current_date - interval '110 years')`,
  eintritt_nach_austritt:
    "deleted_at is null and eintritt is not null and austritt is not null and austritt < eintritt",
  austritt_offene_vertraege:
    "deleted_at is null and austritt is not null and exists (select 1 from contracts c where c.member_id = members.id and c.gekuend_zum is null and c.vertrag_ende is null)",
  fehlende_email: `${ACTIVE} and (email is null or btrim(email) = '')`,
  email_ungueltig: `${ACTIVE} and email is not null and btrim(email) <> '' and btrim(email) !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
  // Refined (issue #79): only flag a shared email when at least one other
  // holder sits at a DIFFERENT address. A matching address is a household
  // sharing one mailbox (common for couples/families) and is not a problem.
  email_mehrfach:
    "deleted_at is null and email is not null and btrim(email) <> '' and exists (select 1 from members m2 where m2.deleted_at is null and m2.id <> members.id and lower(btrim(m2.email)) = lower(btrim(members.email)) and (lower(btrim(coalesce(m2.strasse,''))) is distinct from lower(btrim(coalesce(members.strasse,''))) or lower(btrim(coalesce(m2.plz,''))) is distinct from lower(btrim(coalesce(members.plz,''))) or lower(btrim(coalesce(m2.ort,''))) is distinct from lower(btrim(coalesce(members.ort,'')))))",
  plz_ungueltig: `${ACTIVE} and plz is not null and btrim(plz) <> '' and (land is null or btrim(land) = '' or lower(btrim(land)) in ('de','d','deutschland','germany')) and btrim(plz) !~ '^[0-9]{5}$'`,
  geschlecht_unbekannt: `${ACTIVE} and (geschlecht is null or geschlecht = 'unbekannt') and not ${ANREDE_HAS_GENDER}`,
  vertrag_ohne_beitragsart: `${ACTIVE} and exists (select 1 from contracts c where c.member_id = members.id and (c.art_name is null or btrim(c.art_name) = ''))`,
  mahnsperre_gesetzt: `${ACTIVE} and dunning_blocked = true`,
  moegliche_dubletten:
    "deleted_at is null and nachname is not null and geburtsdatum is not null and exists (select 1 from members m2 where m2.deleted_at is null and m2.id <> members.id and lower(m2.nachname) = lower(members.nachname) and lower(coalesce(m2.vorname, '')) = lower(coalesce(members.vorname, '')) and m2.geburtsdatum = members.geburtsdatum)",
  // Phone field holds only a Vorwahl: after stripping non-digits, 1-5 digits
  // remain (a German area code is 3-5 digits) with no subscriber number.
  telefon_nur_vorwahl: `${ACTIVE} and telefon1 is not null and btrim(telefon1) <> '' and char_length(regexp_replace(telefon1, '[^0-9]', '', 'g')) between 1 and 5`,
  // Active mandate whose validity has already lapsed while a Lastschrift
  // Same Mitgliedsnummer on more than one non-deleted record (see migration
  // 0048, which also adds a DB-level partial unique index).
  mitgliedsnummer_kollision:
    "deleted_at is null and mitgliedsnummer is not null and btrim(mitgliedsnummer) <> '' and exists (select 1 from members m2 where m2.deleted_at is null and m2.id <> members.id and m2.mitgliedsnummer = members.mitgliedsnummer)",
  // Nachname holds a name that occurs as a Vorname on >= 2 other records, while
  // the Vorname is not itself such a common first name: likely swapped fields.
  name_reihenfolge_vertauscht:
    "deleted_at is null and nachname is not null and btrim(nachname) <> '' and lower(btrim(nachname)) in (select lower(btrim(vorname)) from members where deleted_at is null and vorname is not null and btrim(vorname) <> '' group by lower(btrim(vorname)) having count(*) >= 2) and lower(btrim(coalesce(vorname, ''))) not in (select lower(btrim(vorname)) from members where deleted_at is null and vorname is not null and btrim(vorname) <> '' group by lower(btrim(vorname)) having count(*) >= 2)",
  // A couple crammed into one record: the name carries a connector word.
  mehrere_personen_im_datensatz:
    "deleted_at is null and (coalesce(vorname, '') || ' ' || coalesce(nachname, '')) ~* '(^|[^[:alnum:]])(u\\.|und|&)([^[:alnum:]]|$)'",
  // Street with no house number in the Strasse field and an empty Hausnummer.
  strasse_ohne_hausnummer: `${ACTIVE} and strasse is not null and btrim(strasse) <> '' and strasse !~ '[0-9]' and (hausnummer is null or btrim(hausnummer) = '')`,
  // Contract priced at 0 for a member that is not formally beitragsbefreit:
  // separates real exemptions from a mistyped amount.
  vertrag_betrag_null: `${ACTIVE} and beitragsbefreit = false and exists (select 1 from contracts c where c.member_id = members.id and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date) and c.betrag is not null and c.betrag = 0)`,
  // Same (vorname, nachname) on >1 record where at least one lacks a
  // Geburtsdatum, which the birthdate-based dubletten check cannot catch.
  dublette_name_ohne_gebdatum:
    "deleted_at is null and nachname is not null and btrim(nachname) <> '' and exists (select 1 from members m2 where m2.deleted_at is null and m2.id <> members.id and lower(m2.nachname) = lower(members.nachname) and lower(coalesce(m2.vorname, '')) = lower(coalesce(members.vorname, '')) and (m2.geburtsdatum is null or members.geburtsdatum is null))",
  // Active contract whose Beitragsart carries an age range the member no longer
  // fits. Age = completed years at today. Only fee types with a configured
  // min/max age are checked; others are skipped (min_age/max_age null).
  tarif_passt_nicht_zum_alter: `${ACTIVE} and geburtsdatum is not null and exists (select 1 from contracts c join fee_types ft on ft.art = c.art where c.member_id = members.id and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date) and ((ft.min_age is not null and extract(year from age(current_date, members.geburtsdatum)) < ft.min_age) or (ft.max_age is not null and extract(year from age(current_date, members.geburtsdatum)) > ft.max_age)))`,
  // Active member who is 18+ but whose active direct-debit contract is paid from
  // a different person's account (Zahler/Vertreter, typically a parent). Reminder
  // to switch to Selbstzahler; nothing is changed automatically.
  volljaehrig_eltern_konto: `${ACTIVE} and geburtsdatum is not null and geburtsdatum <= (current_date - interval '18 years') and (exists (select 1 from contracts c where ${DD_CONTRACT_C} and (${PAYER_FOR_C}) <> members.id) or (${ACTIVE_DD_POS} and ((${ABW_KONTOINH_FREMD}) or (${IBAN_GETEILT_MIT_AELTEREM}))))`,
  // Cloned-from-child import artifact: a member linked to another member shares
  // the exact same Geburtsdatum but has a different Vorname. For parent/child
  // (the typical relationship) an identical full birthdate is impossible, so one
  // record carries a wrong (copied) date. Flags the relationship target; with
  // Linear's reciprocal verkn pairs both sides surface, so the operator can pick
  // which date is wrong.
  beziehung_gleiches_geburtsdatum:
    "deleted_at is null and geburtsdatum is not null and exists (" +
    "select 1 from relationships r join members c on c.id = r.from_member_id " +
    "where r.to_member_id = members.id and c.deleted_at is null " +
    "and c.geburtsdatum = members.geburtsdatum " +
    "and lower(btrim(coalesce(c.vorname, ''))) <> lower(btrim(coalesce(members.vorname, '')))" +
    ")",
};

/**
 * The WHERE clause for a category, but excluding findings a Vorstand has marked
 * as "geprüft" (Ausnahme, `data_quality_exceptions`). Every consumer of the
 * rules -- count, drill-down, CSV export, the nightly snapshot/Aufgaben -- goes
 * through here so an acknowledged finding disappears from all of them at once.
 * `category` is a fixed CategoryId (no user input), safe to interpolate.
 */
export function activeWhere(category: CategoryId): string {
  return (
    `(${WHERE[category]}) and not exists (` +
    `select 1 from data_quality_exceptions e ` +
    `where e.member_id = members.id and e.category = '${category}')`
  );
}

/** Cap the drill-down so a pathological dataset cannot return everything. */
const LIST_LIMIT = 500;

/**
 * Categories with a deterministic one-click fix. A category is AUTO only when
 * the corrected value can be computed with certainty from the member's own
 * data. Most checks need operator input (the value is missing or ambiguous) and
 * are handled by editing the member, not here. New AUTO fixes plug into
 * `computeAutoFix` below.
 */
export const AUTO_FIX_CATEGORIES = ["name_reihenfolge_vertauscht"] as const;

export type AutoFixResult =
  | { patch: Record<string, string>; before: string; after: string }
  | { error: string };

/**
 * Pure: the field patch for a deterministic fix, or an error when the fix does
 * not apply to the member's current values. Kept pure so the transform (and its
 * refuse cases) are unit-testable; the procedure handles re-verify, audit and
 * persistence.
 */
export function computeAutoFix(
  category: CategoryId,
  member: { vorname: string | null; nachname: string | null },
): AutoFixResult {
  switch (category) {
    case "name_reihenfolge_vertauscht": {
      // The detector found `nachname` is a common Vorname and `vorname` is not,
      // so the two are almost certainly swapped. Swap them back. Both must be
      // present, or there is nothing to reorder.
      const vorname = member.vorname?.trim() ?? "";
      const nachname = member.nachname?.trim() ?? "";
      if (!vorname || !nachname) {
        return { error: "Vor- und Nachname müssen beide gefüllt sein." };
      }
      return {
        patch: { vorname: nachname, nachname: vorname },
        before: `${vorname} ${nachname}`,
        after: `${nachname} ${vorname}`,
      };
    }
    default:
      return { error: "Für diese Prüfung gibt es keine automatische Korrektur." };
  }
}

/**
 * Re-check that a finding still holds for one member by running the category's
 * own predicate scoped to that member. `category` is a fixed picklist (safe to
 * interpolate); `memberId` is bound as a parameter.
 */
async function memberStillMatches(
  db: DB,
  category: CategoryId,
  memberId: string,
): Promise<boolean> {
  const res = (await db.execute(
    sql`select exists(select 1 from members where id = ${memberId}::uuid and (${sql.raw(activeWhere(category))})) as ok`,
  )) as unknown as Array<{ ok: boolean }>;
  return res[0]?.ok === true;
}

type MemberRow = {
  id: string;
  member_no: string | null;
  kontakt_no: string | null;
  mitgliedsnummer: string | null;
  adr_nr: number;
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
  ort: string | null;
  email: string | null;
  geburtsdatum: string | Date | null;
  austritt: string | Date | null;
};

function toItem(r: MemberRow) {
  const parts = {
    memberNo: r.member_no,
    kontaktNo: r.kontakt_no,
    mitgliedsnummer: r.mitgliedsnummer,
    adrNr: r.adr_nr,
  };
  return {
    id: r.id,
    reference: memberRef(parts),
    name: memberDisplayName({
      ...parts,
      vorname: r.vorname,
      nachname: r.nachname,
      kurzname: r.kurzname,
      firma1: r.firma1,
    }),
    ort: r.ort,
    email: r.email,
    geburtsdatum: r.geburtsdatum,
    austritt: r.austritt,
  };
}

/**
 * One combined query returning the count for every category. Shared by the
 * summary procedure (sidebar badge) and the nightly snapshot writer so both see
 * identical numbers. Cheap enough to keep warm with a long client staleTime.
 */
export async function dataQualityCounts(db: DB): Promise<Array<CategoryMeta & { count: number }>> {
  const selects = CATEGORY_IDS.map(
    (id) => `(select count(*)::int from members where ${activeWhere(id)}) as "${id}"`,
  ).join(", ");
  const rows = (await db.execute(sql.raw(`select ${selects}`))) as unknown as Array<
    Record<CategoryId, number>
  >;
  const counts = rows[0] ?? ({} as Record<CategoryId, number>);
  return CATEGORIES.map((c) => ({ ...c, count: Number(counts[c.id] ?? 0) }));
}

const SEVERITY_LABEL = { error: "Fehler", warn: "Warnung", info: "Hinweis" } as const;

type FindingExportRow = {
  pruefung: string;
  severity: CategoryMeta["severity"];
  schweregradLabel: string;
  reference: string;
  name: string;
  ort: string | null;
  email: string | null;
};

/**
 * Eine Zeile pro (Prüfung, betroffenem Mitglied), über alle Kategorien, ohne
 * Seitenlimit. Geteilte Quelle für den CSV- und den XLSX-Export, damit beide
 * identische Befunde liefern. Acknowledged (geprüft) ist bereits ausgefiltert.
 */
async function collectFindings(db: DB): Promise<FindingExportRow[]> {
  const rows: FindingExportRow[] = [];
  for (const meta of CATEGORIES) {
    const affected = (await db.execute(
      sql.raw(
        `select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, kurzname, firma1, ort, email, geburtsdatum, austritt ` +
          `from members where ${activeWhere(meta.id)} ` +
          `order by nachname nulls last, vorname nulls last, id`,
      ),
    )) as unknown as MemberRow[];
    for (const r of affected) {
      const item = toItem(r);
      rows.push({
        pruefung: meta.label,
        severity: meta.severity,
        schweregradLabel: SEVERITY_LABEL[meta.severity],
        reference: item.reference,
        name: item.name,
        ort: item.ort,
        email: item.email,
      });
    }
  }
  return rows;
}

export const dataQualityRouter = {
  summary: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const categories = await dataQualityCounts(context.db);
    return {
      categories,
      total: categories.reduce((sum, c) => sum + c.count, 0),
    };
  }),

  /**
   * Affected members for one category, paged at LIST_LIMIT rows. Returns the
   * `cap` (page size) and a `nextCursor` so a client (incl. MCP) knows it did
   * not get everything and can fetch the next page (issue #83). The cursor is
   * an opaque offset; the WHERE clause is deterministic so offset paging is
   * stable across calls.
   */
  list: vorstandProc
    .input(
      v.object({
        category: v.picklist(CATEGORY_IDS),
        cursor: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const offset = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
      const rows = (await context.db.execute(
        sql.raw(
          `select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, kurzname, firma1, ort, email, geburtsdatum, austritt ` +
            `from members where ${activeWhere(input.category)} ` +
            `order by nachname nulls last, vorname nulls last, id ` +
            `limit ${LIST_LIMIT} offset ${offset}`,
        ),
      )) as unknown as MemberRow[];
      const meta = CATEGORIES.find((c) => c.id === input.category) ?? null;
      const capped = rows.length >= LIST_LIMIT;
      return {
        category: meta,
        items: rows.map(toItem),
        capped,
        /** The page size cap, so the client knows the limit. */
        cap: LIST_LIMIT,
        /** Opaque cursor for the next page, or null when this is the last. */
        nextCursor: capped ? String(offset + rows.length) : null,
      };
    }),

  /**
   * Vollexport aller Befunde als CSV: jede Prüfung, jede betroffene Zeile,
   * ohne das 500er-Seitenlimit der Drill-down-Liste. Eine Zeile pro
   * (Prüfung, Mitglied); Mitglieder mit mehreren Befunden erscheinen
   * entsprechend mehrfach. Für die Offline-Abarbeitung im Vorstand.
   */
  exportCsv: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rows = await collectFindings(context.db);
    const content = toCsv(rows, [
      { key: "pruefung", label: "Prüfung" },
      { key: "schweregradLabel", label: "Schweregrad" },
      { key: "reference", label: "Mitgliedsnummer" },
      { key: "name", label: "Name" },
      { key: "ort", label: "Ort" },
      { key: "email", label: "E-Mail" },
    ] satisfies CsvColumn<FindingExportRow>[]);
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `datenqualitaet-${stamp}.csv`, content, count: rows.length };
  }),

  /**
   * Wie `exportCsv`, aber als formatierte XLSX: Blatt "Übersicht" (Zählung je
   * Prüfung, nach Schweregrad) und Blatt "Befunde" (eine Zeile je Treffer).
   * Kopfzeile in der Markenfarbe, Schweregrad farbig, Autofilter, fixierte
   * Kopfzeile. exceljs wird nur hier (server-seitig) geladen.
   */
  exportXlsx: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const [rows, counts] = await Promise.all([
      collectFindings(context.db),
      dataQualityCounts(context.db),
    ]);
    const [org] = await context.db
      .select({
        vereinsname: organizationSettingsTable.vereinsname,
        anzeigename: organizationSettingsTable.anzeigename,
        primaryColor: organizationSettingsTable.primaryColor,
      })
      .from(organizationSettingsTable)
      .limit(1);
    const base64 = await buildDataQualityWorkbook({
      rows,
      counts,
      title: org?.anzeigename?.trim() || org?.vereinsname || "Verein",
      primaryColor: org?.primaryColor ?? null,
      generatedAt: new Date(),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `datenqualitaet-${stamp}.xlsx`, base64, count: rows.length };
  }),

  /**
   * Einen Befund (Prüfung + Mitglied) als geprüft markieren. Der Treffer
   * verschwindet aus Zählung, Liste, Export und Aufgaben, bleibt aber als
   * Ausnahme nachvollziehbar. Erneutes Markieren aktualisiert nur den Grund.
   */
  acknowledge: vorstandProc
    .input(
      v.object({
        category: v.picklist(CATEGORY_IDS),
        memberId: v.string(),
        reason: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      await context.db
        .insert(dataQualityExceptionsTable)
        .values({
          category: input.category,
          memberId: input.memberId,
          reason,
          createdBy: context.session!.user.id,
          createdByEmail: context.session!.user.email,
        })
        .onConflictDoUpdate({
          target: [dataQualityExceptionsTable.category, dataQualityExceptionsTable.memberId],
          set: {
            reason,
            createdBy: context.session!.user.id,
            createdByEmail: context.session!.user.email,
            createdAt: new Date(),
          },
        });
      return { ok: true };
    }),

  /**
   * Einen Befund automatisch korrigieren (nur die deterministischen Prüfungen
   * in AUTO_FIX_CATEGORIES, z. B. vertauschte Namensreihenfolge). Prüft vor dem
   * Anwenden, dass der Befund noch besteht (die Liste des Vorstands kann
   * veraltet sein), schreibt einen Audit-Eintrag und einen Snapshot (damit die
   * Änderung rückholbar bleibt) und leert die Caches. Gibt Vorher/Nachher für
   * die Bestätigung zurück.
   */
  applyFix: vorstandProc
    .input(
      v.object({
        category: v.picklist(CATEGORY_IDS),
        memberId: v.pipe(v.string(), v.uuid()),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!(AUTO_FIX_CATEGORIES as readonly string[]).includes(input.category)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Für diese Prüfung gibt es keine automatische Korrektur.",
        });
      }
      if (!(await memberStillMatches(context.db, input.category, input.memberId))) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Der Befund besteht nicht mehr. Bitte die Liste aktualisieren.",
        });
      }
      const [member] = await context.db
        .select({ vorname: membersTable.vorname, nachname: membersTable.nachname })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const fix = computeAutoFix(input.category, member);
      if ("error" in fix) {
        throw new ORPCError("PRECONDITION_FAILED", { message: fix.error });
      }

      await context.db.transaction(async (tx) => {
        await tx
          .update(membersTable)
          .set({ ...fix.patch, updatedAt: new Date() } as never)
          .where(eq(membersTable.id, input.memberId));
        const changes = {
          ...diff({ vorname: member.vorname, nachname: member.nachname }, fix.patch),
          // Mark the edit as a data-quality auto-fix in the audit trail without
          // a dedicated audit_action enum value.
          __datenqualitaet: { before: null, after: input.category },
        };
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes,
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });
      await invalidateMemberCaches(context.tenant.key);
      return { ok: true, before: fix.before, after: fix.after };
    }),

  /** Eine Ausnahme zurücknehmen: der Befund taucht wieder in der Liste auf. */
  unacknowledge: vorstandProc
    .input(v.object({ category: v.picklist(CATEGORY_IDS), memberId: v.string() }))
    .handler(async ({ context, input }) => {
      await context.db
        .delete(dataQualityExceptionsTable)
        .where(
          and(
            eq(dataQualityExceptionsTable.category, input.category),
            eq(dataQualityExceptionsTable.memberId, input.memberId),
          ),
        );
      return { ok: true };
    }),

  /** Die als geprüft markierten Mitglieder einer Prüfung, für die "Geprüft"-Liste. */
  acknowledged: vorstandProc
    .input(v.object({ category: v.picklist(CATEGORY_IDS) }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select({
          memberId: dataQualityExceptionsTable.memberId,
          reason: dataQualityExceptionsTable.reason,
          createdByEmail: dataQualityExceptionsTable.createdByEmail,
          createdAt: dataQualityExceptionsTable.createdAt,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          adrNr: membersTable.adrNr,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          kurzname: membersTable.kurzname,
          firma1: membersTable.firma1,
        })
        .from(dataQualityExceptionsTable)
        .innerJoin(membersTable, eq(membersTable.id, dataQualityExceptionsTable.memberId))
        .where(eq(dataQualityExceptionsTable.category, input.category))
        .orderBy(desc(dataQualityExceptionsTable.createdAt));
      return {
        items: rows.map((r) => ({
          id: r.memberId,
          reference: memberRef(r),
          name: memberDisplayName(r),
          reason: r.reason,
          createdByEmail: r.createdByEmail,
          createdAt: r.createdAt,
        })),
      };
    }),
};
