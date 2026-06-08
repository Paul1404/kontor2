import { sql } from "drizzle-orm";
import * as v from "valibot";
import { memberDisplayName, memberRef } from "~/server/domain/member";
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
  "fehlende_email",
  "fehlende_adresse",
  "minderjaehrig_ohne_vertretung",
  "vertrag_ohne_beitragsart",
  "austritt_offene_vertraege",
  "moegliche_dubletten",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export type CategoryMeta = {
  id: CategoryId;
  /** Short German label for the issue. */
  label: string;
  /** One-sentence explanation of what the check finds and why it matters. */
  description: string;
  /** "warn" = should be fixed, "info" = worth a look. Drives the UI accent. */
  severity: "warn" | "info";
};

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "lastschrift_ohne_mandat",
    label: "Lastschrift ohne SEPA-Mandat",
    description:
      "Mitglieder mit aktivem Lastschrift-Vertrag, aber ohne gültiges SEPA-Mandat. Ein Einzug ist so nicht möglich.",
    severity: "warn",
  },
  {
    id: "fehlende_iban",
    label: "Lastschrift ohne IBAN",
    description:
      "Mitglieder mit aktivem Lastschrift-Vertrag, aber ohne hinterlegte IBAN. Der Beitrag kann nicht eingezogen werden.",
    severity: "warn",
  },
  {
    id: "fehlende_email",
    label: "Keine E-Mail-Adresse",
    description: "Aktive Mitglieder ohne E-Mail. Sie sind nur per Post erreichbar.",
    severity: "info",
  },
  {
    id: "fehlende_adresse",
    label: "Unvollständige Anschrift",
    description: "Aktive Mitglieder ohne Straße, PLZ oder Ort. Postversand ist nicht möglich.",
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
    id: "vertrag_ohne_beitragsart",
    label: "Vertrag ohne Beitragsart",
    description:
      "Aktive Mitglieder mit einem Vertrag ohne hinterlegte Bezeichnung der Beitragsart.",
    severity: "info",
  },
  {
    id: "austritt_offene_vertraege",
    label: "Austritt mit offenem Vertrag",
    description:
      "Ausgetretene Mitglieder, deren Vertrag weder gekündigt noch beendet ist. Der Austritt ist nicht sauber abgeschlossen.",
    severity: "warn",
  },
  {
    id: "moegliche_dubletten",
    label: "Mögliche Dubletten",
    description:
      "Mehrere Datensätze mit gleichem Namen und Geburtsdatum. Eventuell ist jemand doppelt erfasst.",
    severity: "info",
  },
];

/** A live member: not soft-deleted, neither exited nor deceased. */
const ACTIVE = "deleted_at is null and austritt is null and verstorben_am is null";

/** Active direct-debit contract that is not cancelled or expired. */
const ACTIVE_DD =
  "exists (select 1 from contracts c where c.member_id = members.id and c.is_direct_debit = true " +
  "and c.gekuend_zum is null and (c.vertrag_ende is null or c.vertrag_ende >= current_date))";

/** WHERE clause per category. No user input -- safe to compose with sql.raw. */
const WHERE: Record<CategoryId, string> = {
  lastschrift_ohne_mandat: `${ACTIVE} and ${ACTIVE_DD} and not exists (select 1 from sepa_mandates s where s.member_id = members.id and coalesce(s.is_deleted, false) = false and s.widerrufen_am is null)`,
  fehlende_iban: `${ACTIVE} and ${ACTIVE_DD} and (iban1_last4 is null or btrim(iban1_last4) = '')`,
  fehlende_email: `${ACTIVE} and (email is null or btrim(email) = '')`,
  fehlende_adresse: `${ACTIVE} and (strasse is null or btrim(strasse) = '' or plz is null or btrim(plz) = '' or ort is null or btrim(ort) = '')`,
  minderjaehrig_ohne_vertretung: `${ACTIVE} and geburtsdatum is not null and geburtsdatum > (current_date - interval '18 years') and (vertreter_name is null or btrim(vertreter_name) = '') and not exists (select 1 from relationships r where r.from_member_id = members.id and r.ist_vertreter = true)`,
  vertrag_ohne_beitragsart: `${ACTIVE} and exists (select 1 from contracts c where c.member_id = members.id and (c.art_name is null or btrim(c.art_name) = ''))`,
  austritt_offene_vertraege:
    "deleted_at is null and austritt is not null and exists (select 1 from contracts c where c.member_id = members.id and c.gekuend_zum is null and c.vertrag_ende is null)",
  moegliche_dubletten:
    "deleted_at is null and nachname is not null and geburtsdatum is not null and exists (select 1 from members m2 where m2.deleted_at is null and m2.id <> members.id and lower(m2.nachname) = lower(members.nachname) and lower(coalesce(m2.vorname, '')) = lower(coalesce(members.vorname, '')) and m2.geburtsdatum = members.geburtsdatum)",
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

export const dataQualityRouter = {
  /**
   * One combined query returning the count for every category. Cheap enough to
   * also back the sidebar badge; the client keeps it warm with a long
   * staleTime so navigation does not re-run it.
   */
  summary: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const selects = CATEGORY_IDS.map(
      (id) => `(select count(*)::int from members where ${WHERE[id]}) as "${id}"`,
    ).join(", ");
    const rows = (await context.db.execute(sql.raw(`select ${selects}`))) as unknown as Array<
      Record<CategoryId, number>
    >;
    const counts = rows[0] ?? ({} as Record<CategoryId, number>);
    const categories = CATEGORIES.map((c) => ({ ...c, count: Number(counts[c.id] ?? 0) }));
    return {
      categories,
      total: categories.reduce((sum, c) => sum + c.count, 0),
    };
  }),

  /** Affected members for one category, capped at LIST_LIMIT. */
  list: vorstandProc
    .input(v.object({ category: v.picklist(CATEGORY_IDS) }))
    .handler(async ({ context, input }) => {
      const rows = (await context.db.execute(
        sql.raw(
          `select id, member_no, kontakt_no, mitgliedsnummer, adr_nr, vorname, nachname, kurzname, firma1, ort, email, geburtsdatum, austritt ` +
            `from members where ${WHERE[input.category]} ` +
            `order by nachname nulls last, vorname nulls last limit ${LIST_LIMIT}`,
        ),
      )) as unknown as MemberRow[];
      const meta = CATEGORIES.find((c) => c.id === input.category) ?? null;
      return {
        category: meta,
        items: rows.map(toItem),
        capped: rows.length >= LIST_LIMIT,
      };
    }),
};
