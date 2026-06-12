import { sql } from "drizzle-orm";
import * as v from "valibot";
import type { DB } from "~/server/db/client";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { type CsvColumn, toCsv } from "~/server/lib/csv";
import { vorstandProc } from "~/server/orpc/base";

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
  "mandat_abgelaufen",
  "mandat_laeuft_bald_ab",
  "mitgliedsnummer_kollision",
  "name_reihenfolge_vertauscht",
  "mehrere_personen_im_datensatz",
  "strasse_ohne_hausnummer",
  "vertrag_betrag_null",
  "dublette_name_ohne_gebdatum",
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
    severity: "warn",
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
    id: "mandat_abgelaufen",
    label: "SEPA-Mandat abgelaufen",
    description:
      "Aktives Mandat, dessen Gültigkeit abgelaufen ist, während noch ein Lastschrift-Vertrag läuft. Ein Einzug ist nicht zulässig.",
    severity: "error",
  },
  {
    id: "mandat_laeuft_bald_ab",
    label: "SEPA-Mandat läuft bald ab",
    description:
      "Aktives Mandat, das in den nächsten 90 Tagen abläuft, während ein Lastschrift-Vertrag besteht. Rechtzeitig erneuern.",
    severity: "info",
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
 * Resolved payer (Zahler) of a member, as a scalar member id: the active
 * family payer (kind role) -> the Vertreter (minors only) -> the member itself.
 * Mirrors `resolveZahler` so the mandate/IBAN checks follow who actually pays
 * instead of flagging a child whose parent or family holds the mandate.
 * (The per-contract `zahler_member_id` override of Zahler-Konzept Stufe 2 is
 * not folded in here yet; prepend it once it exists.)
 */
const PAYER =
  "coalesce(" +
  "(select fam.zahler_member_id from familien_mitglieder fm join familien fam on fam.id = fm.familie_id " +
  "where fm.member_id = members.id and fm.bis is null and fm.rolle = 'kind' limit 1), " +
  "(select r.to_member_id from relationships r where r.from_member_id = members.id and r.ist_vertreter = true " +
  "and members.geburtsdatum is not null and members.geburtsdatum > current_date - interval '18 years' limit 1), " +
  "members.id)";

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
  lastschrift_ohne_mandat: `${ACTIVE} and ${ACTIVE_DD_POS} and not exists (select 1 from sepa_mandates s where s.member_id = (${PAYER}) and coalesce(s.is_deleted, false) = false and s.widerrufen_am is null)`,
  fehlende_iban: `${ACTIVE} and ${ACTIVE_DD_POS} and not exists (select 1 from members p where p.id = (${PAYER}) and p.iban1_last4 is not null and btrim(p.iban1_last4) <> '')`,
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
  // contract still runs: the next Einzug would be unauthorized.
  mandat_abgelaufen: `${ACTIVE} and ${ACTIVE_DD_POS} and exists (select 1 from sepa_mandates s where s.member_id = members.id and coalesce(s.is_deleted, false) = false and s.widerrufen_am is null and lower(btrim(coalesce(s.status, ''))) = 'aktiv' and s.gultig_bis is not null and s.gultig_bis::date < current_date)`,
  // Same, but the mandate still has up to 90 days left: a heads-up to renew.
  mandat_laeuft_bald_ab: `${ACTIVE} and ${ACTIVE_DD_POS} and exists (select 1 from sepa_mandates s where s.member_id = members.id and coalesce(s.is_deleted, false) = false and s.widerrufen_am is null and lower(btrim(coalesce(s.status, ''))) = 'aktiv' and s.gultig_bis is not null and s.gultig_bis::date >= current_date and s.gultig_bis::date < current_date + interval '90 days')`,
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
};

/** Cap the drill-down so a pathological dataset cannot return everything. */
const LIST_LIMIT = 500;

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
    (id) => `(select count(*)::int from members where ${WHERE[id]}) as "${id}"`,
  ).join(", ");
  const rows = (await db.execute(sql.raw(`select ${selects}`))) as unknown as Array<
    Record<CategoryId, number>
  >;
  const counts = rows[0] ?? ({} as Record<CategoryId, number>);
  return CATEGORIES.map((c) => ({ ...c, count: Number(counts[c.id] ?? 0) }));
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
            `from members where ${WHERE[input.category]} ` +
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
    type ExportRow = {
      pruefung: string;
      schweregrad: string;
      reference: string;
      name: string;
      ort: string | null;
      email: string | null;
    };
    const severityLabel = { error: "Fehler", warn: "Warnung", info: "Hinweis" } as const;
    const rows: ExportRow[] = [];
    for (const meta of CATEGORIES) {
      const affected = (await context.db.execute(
        sql.raw(
          `select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, kurzname, firma1, ort, email, geburtsdatum, austritt ` +
            `from members where ${WHERE[meta.id]} ` +
            `order by nachname nulls last, vorname nulls last, id`,
        ),
      )) as unknown as MemberRow[];
      for (const r of affected) {
        const item = toItem(r);
        rows.push({
          pruefung: meta.label,
          schweregrad: severityLabel[meta.severity],
          reference: item.reference,
          name: item.name,
          ort: item.ort,
          email: item.email,
        });
      }
    }
    const content = toCsv(rows, [
      { key: "pruefung", label: "Prüfung" },
      { key: "schweregrad", label: "Schweregrad" },
      { key: "reference", label: "Mitgliedsnummer" },
      { key: "name", label: "Name" },
      { key: "ort", label: "Ort" },
      { key: "email", label: "E-Mail" },
    ] satisfies CsvColumn<ExportRow>[]);
    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `datenqualitaet-${stamp}.csv`, content, count: rows.length };
  }),
};
