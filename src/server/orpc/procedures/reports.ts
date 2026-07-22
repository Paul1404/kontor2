import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { escapeLike } from "~/server/db/like";
import {
  memberHasDied,
  memberHasExited,
  memberHasPendingExit,
  memberHasRealAbteilung,
  memberIsPassiv,
  memberNotDeceased,
  memberNotDeleted,
  memberNotExited,
} from "~/server/db/member-filters";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { memberRef } from "~/server/domain/member";
import { type CsvColumn, toCsv } from "~/server/lib/csv";
import { authedProc, vorstandProc } from "~/server/orpc/base";
import type { AppContext } from "~/server/orpc/context";
import { isRoundBirthday } from "~/server/reports/birthday";
import { isExcludedFromJubilee, jubileeDateFor, jubileeYearFor } from "~/server/reports/jubilee";
import { CACHE_NS, cached } from "~/server/search/cache";

const StatusSchema = v.picklist([
  "aktiv",
  "passiv",
  "gekuendigt",
  "ausgetreten",
  "verstorben",
  "alle",
]);

const MemberExportInput = v.object({
  q: v.optional(v.string(), ""),
  status: v.optional(StatusSchema, "aktiv"),
  abteilungId: v.optional(v.nullable(v.string()), null),
  includeAusgetretene: v.optional(v.boolean(), false),
  // When present, export exactly these members and ignore the filter
  // fields above. Used by the "Auswahl als CSV" bulk action so the file
  // matches the rows the user ticked, not the active filter.
  ids: v.optional(v.array(v.pipe(v.string(), v.uuid()))),
});

const GeburtstageInput = v.object({
  month: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(12)),
  year: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200)),
    new Date().getUTCFullYear(),
  ),
  abteilungId: v.optional(v.nullable(v.string()), null),
});

const EhrungenInput = v.object({
  year: v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200)),
  jubilaeen: v.optional(v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(150)))),
});

const YearInput = v.object({
  year: v.pipe(v.number(), v.integer(), v.minValue(1900), v.maxValue(2200)),
});

const DEFAULT_JUBILAEEN = [25, 40, 50, 60, 70, 75];

function formatDateDE(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(d.getTime())) return "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

/**
 * Derived Aktiv/Passiv label for the CSV export. The stored `status` no longer
 * carries the passive axis; this mirrors the on-screen badge: deceased and
 * exited win, otherwise a member is aktiv while they hold an active membership
 * in a real Abteilung, else passiv.
 */
function aktivPasivLabel() {
  return sql<string>`case
    when ${membersTable.verstorbenAm} is not null and ${membersTable.verstorbenAm}::date <= current_date then 'verstorben'
    when ${membersTable.austritt} is not null and ${membersTable.austritt}::date <= current_date then 'ausgetreten'
    when ${memberHasRealAbteilung()} then 'aktiv'
    else 'passiv'
  end`;
}

function buildMemberWhereClauses(input: v.InferOutput<typeof MemberExportInput>) {
  const conditions: ReturnType<typeof eq>[] = [];
  // "Exited" means the Austritt date has arrived; a notice for a future date
  // still counts as active (see `memberNotExited`), matching the members list.
  if (!input.includeAusgetretene && input.status !== "ausgetreten") {
    conditions.push(memberNotExited() as never);
  }
  if (input.status === "ausgetreten") {
    conditions.push(memberHasExited() as never);
  }
  if (input.status === "verstorben") {
    conditions.push(memberHasDied() as never);
  }
  if (input.status === "gekuendigt") {
    conditions.push(memberHasPendingExit() as never);
  }
  if (input.status === "aktiv") {
    // Mirror the members list: "aktiv" means a living member (not exited, not
    // deceased) MIT aktiver Mitgliedschaft in einer echten Abteilung. The
    // Abteilung condition keeps the CSV in sync with the on-screen Aktiv-Liste
    // und dem Aktiv/Passiv-Badge; ohne sie rutschten passive Mitglieder in die
    // Aktiv-CSV. Direkt erzwungen, damit es auch bei `includeAusgetretene` gilt.
    conditions.push(memberNotExited() as never);
    conditions.push(memberNotDeceased() as never);
    conditions.push(memberHasRealAbteilung() as never);
  }
  if (input.status === "passiv") {
    // Passiv is derived, not stored: a live member with no active membership
    // in a real Abteilung. `memberIsPassiv` already excludes exited and
    // deceased members, matching the members list.
    conditions.push(memberIsPassiv() as never);
  }
  conditions.push(memberNotDeleted() as never);
  if (input.q.trim()) {
    const like = `%${escapeLike(input.q.trim())}%`;
    conditions.push(
      or(
        ilike(membersTable.nachname, like),
        ilike(membersTable.vorname, like),
        ilike(membersTable.mitgliedsnummer, like),
        ilike(membersTable.email, like),
        ilike(membersTable.ort, like),
      ) as never,
    );
  }
  return conditions;
}

type BirthdayRow = {
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: Date | null;
  geburtsjahr: number | null;
  tag: number | null;
  ort: string | null;
  alter: number;
  rund: boolean;
};

async function loadGeburtstage(
  db: AppContext["db"],
  input: v.InferOutput<typeof GeburtstageInput>,
): Promise<{ month: number; year: number; rows: BirthdayRow[] }> {
  const monthExpr = sql<number>`extract(month from ${membersTable.geburtsdatum})::int`;
  const dayExpr = sql<number>`extract(day from ${membersTable.geburtsdatum})::int`;
  const yearExpr = sql<number>`extract(year from ${membersTable.geburtsdatum})::int`;

  const conditions = [
    isNotNull(membersTable.geburtsdatum) as never,
    // Include members whose exit/death happens after the requested birthday.
    // A future lifecycle date must not remove them from an earlier month's list.
    sql`(${membersTable.austritt} is null or ${membersTable.austritt}::date >= (make_date(${input.year}, ${input.month}, 1) + (${dayExpr} - 1)))` as never,
    sql`(${membersTable.verstorbenAm} is null or ${membersTable.verstorbenAm}::date >= (make_date(${input.year}, ${input.month}, 1) + (${dayExpr} - 1)))` as never,
    memberNotDeleted() as never,
    sql`${monthExpr} = ${input.month}` as never,
  ];

  if (input.abteilungId) {
    const idRows = await db
      .select({ memberId: memberAbteilungenTable.memberId })
      .from(memberAbteilungenTable)
      .where(
        and(
          eq(memberAbteilungenTable.abteilungId, input.abteilungId),
          isNull(memberAbteilungenTable.austrittsdatum),
        ),
      );
    const ids = idRows.map((r) => r.memberId);
    if (ids.length === 0) return { rows: [], month: input.month, year: input.year };
    conditions.push(inArray(membersTable.id, ids) as never);
  }

  const rows = await db
    .select({
      id: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      geburtsdatum: membersTable.geburtsdatum,
      tag: dayExpr,
      geburtsjahr: yearExpr,
      ort: membersTable.ort,
    })
    .from(membersTable)
    .where(and(...conditions))
    .orderBy(sql`extract(day from ${membersTable.geburtsdatum}) asc`);

  const enriched: BirthdayRow[] = rows.map((r) => {
    const alter = r.geburtsjahr != null ? input.year - r.geburtsjahr : 0;
    return { ...r, alter, rund: isRoundBirthday(alter) };
  });
  return { month: input.month, year: input.year, rows: enriched };
}

type JubileeMemberRow = {
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  vorname: string | null;
  nachname: string | null;
  ort: string | null;
  eintritt: Date;
  jubilaeumsDatum: Date;
};

async function loadEhrungen(
  db: AppContext["db"],
  input: v.InferOutput<typeof EhrungenInput>,
): Promise<{ year: number; groups: Array<{ jubilee: number; members: JubileeMemberRow[] }> }> {
  const jubilaeen = (input.jubilaeen?.length ? input.jubilaeen : DEFAULT_JUBILAEEN)
    .slice()
    .sort((a, b) => b - a);

  const conditions = [
    isNotNull(membersTable.eintritt) as never,
    memberNotDeleted() as never,
    inArray(
      sql<number>`extract(year from ${membersTable.eintritt})::int`,
      jubilaeen.map((j) => input.year - j),
    ) as never,
  ];

  const rows = await db
    .select({
      id: membersTable.id,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      eintritt: membersTable.eintritt,
      austritt: membersTable.austritt,
      verstorbenAm: membersTable.verstorbenAm,
      ort: membersTable.ort,
    })
    .from(membersTable)
    .where(and(...conditions))
    .orderBy(asc(membersTable.nachname), asc(membersTable.vorname));

  const groups = jubilaeen.map((jubilee) => {
    const members: JubileeMemberRow[] = rows
      .filter((r) => r.eintritt && jubileeYearFor(r.eintritt, jubilee) === input.year)
      .filter(
        (r) =>
          !isExcludedFromJubilee(
            { austritt: r.austritt, verstorbenAm: r.verstorbenAm },
            jubileeDateFor(r.eintritt as Date, jubilee),
          ),
      )
      .map((r) => ({
        id: r.id,
        memberNo: r.memberNo,
        kontaktNo: r.kontaktNo,
        mitgliedsnummer: r.mitgliedsnummer,
        vorname: r.vorname,
        nachname: r.nachname,
        ort: r.ort,
        eintritt: r.eintritt as Date,
        jubilaeumsDatum: jubileeDateFor(r.eintritt as Date, jubilee),
      }));
    return { jubilee, members };
  });
  return { year: input.year, groups };
}

type AbteilungStatRow = {
  abteilungId: string;
  name: string;
  aktivCount: number;
  joiners: number;
  leavers: number;
};

async function loadAbteilungStats(
  db: AppContext["db"],
  input: v.InferOutput<typeof YearInput>,
): Promise<{ year: number; rows: AbteilungStatRow[] }> {
  const startOfYear = new Date(Date.UTC(input.year, 0, 1)).toISOString().slice(0, 10);
  const endOfYear = new Date(Date.UTC(input.year, 11, 31)).toISOString().slice(0, 10);

  // Exclude soft-deleted members: join to members and gate every count on
  // `deleted_at is null`, so a deleted member's Abteilung row no longer inflates
  // the statistics.
  const notDeleted = sql`${membersTable.deletedAt} is null`;
  const rows = await db
    .select({
      abteilungId: abteilungenTable.id,
      name: abteilungenTable.name,
      aktivCount: sql<number>`count(${memberAbteilungenTable.memberId}) filter (where ${memberAbteilungenTable.austrittsdatum} is null and ${notDeleted})::int`,
      joiners: sql<number>`count(${memberAbteilungenTable.memberId}) filter (where ${memberAbteilungenTable.eintrittsdatum} between ${startOfYear}::date and ${endOfYear}::date and ${notDeleted})::int`,
      leavers: sql<number>`count(${memberAbteilungenTable.memberId}) filter (where ${memberAbteilungenTable.austrittsdatum} between ${startOfYear}::date and ${endOfYear}::date and ${notDeleted})::int`,
    })
    .from(abteilungenTable)
    .leftJoin(memberAbteilungenTable, eq(memberAbteilungenTable.abteilungId, abteilungenTable.id))
    .leftJoin(membersTable, eq(membersTable.id, memberAbteilungenTable.memberId))
    .groupBy(abteilungenTable.id, abteilungenTable.name)
    .orderBy(asc(abteilungenTable.name));

  return { year: input.year, rows };
}

type FinanzberichtData = {
  year: number;
  totals: { billed: string; paid: string; open: string; count: number };
  perAbteilung: Array<{
    abteilung: string;
    billed: string;
    paid: string;
    open: string;
    count: number;
  }>;
  perFeeType: Array<{
    art: number;
    bezeichnung: string | null;
    billed: string;
    paid: string;
    open: string;
    count: number;
  }>;
};

async function loadFinanzbericht(
  db: AppContext["db"],
  input: v.InferOutput<typeof YearInput>,
): Promise<FinanzberichtData> {
  // Exclude postings of soft-deleted members so the Finanzbericht matches every
  // other report. The legacy `geloscht` flag is folded into `deletedAt`.
  const notDeleted = memberNotDeleted();

  const totalsRows = await db
    .select({
      billed: sql<string>`coalesce(sum(${sollStellungenTable.amount}), 0)::text`,
      paid: sql<string>`coalesce(sum(${sollStellungenTable.paidAmount}), 0)::text`,
      open: sql<string>`coalesce(sum(${sollStellungenTable.openAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
    .where(
      and(
        eq(sollStellungenTable.billingYear, input.year),
        ne(sollStellungenTable.status, "cancelled"),
        notDeleted,
      ),
    );
  const totals = totalsRows[0] ?? { billed: "0", paid: "0", open: "0", count: 0 };

  const perAbteilung = await db
    .select({
      abteilung: sql<string>`coalesce(${feeTypesTable.abteilung}, '(ohne Abteilung)')`,
      billed: sql<string>`coalesce(sum(${sollStellungenTable.amount}), 0)::text`,
      paid: sql<string>`coalesce(sum(${sollStellungenTable.paidAmount}), 0)::text`,
      open: sql<string>`coalesce(sum(${sollStellungenTable.openAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
    .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
    .leftJoin(feeTypesTable, eq(feeTypesTable.art, contractsTable.art))
    .where(
      and(
        eq(sollStellungenTable.billingYear, input.year),
        ne(sollStellungenTable.status, "cancelled"),
        notDeleted,
      ),
    )
    .groupBy(feeTypesTable.abteilung)
    .orderBy(sql`coalesce(${feeTypesTable.abteilung}, '(ohne Abteilung)')`);

  const perFeeType = await db
    .select({
      art: contractsTable.art,
      bezeichnung: sql<
        string | null
      >`coalesce(${feeTypesTable.bezeichnung}, ${contractsTable.artName})`,
      billed: sql<string>`coalesce(sum(${sollStellungenTable.amount}), 0)::text`,
      paid: sql<string>`coalesce(sum(${sollStellungenTable.paidAmount}), 0)::text`,
      open: sql<string>`coalesce(sum(${sollStellungenTable.openAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
    .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
    .leftJoin(feeTypesTable, eq(feeTypesTable.art, contractsTable.art))
    .where(
      and(
        eq(sollStellungenTable.billingYear, input.year),
        ne(sollStellungenTable.status, "cancelled"),
        notDeleted,
      ),
    )
    .groupBy(contractsTable.art, feeTypesTable.bezeichnung, contractsTable.artName)
    .orderBy(asc(contractsTable.art));

  return { year: input.year, totals, perAbteilung, perFeeType };
}

type MemberExportRow = {
  mitgliedsnummer: string | null;
  anrede: string | null;
  titel: string | null;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: Date | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  eintritt: Date | null;
  austritt: Date | null;
  verstorbenAm: Date | null;
  aktivPasiv: string | null;
};

const MEMBER_EXPORT_COLUMNS: readonly CsvColumn<MemberExportRow>[] = [
  { key: "mitgliedsnummer", label: "Mitgl.-Nr." },
  { key: "anrede", label: "Anrede" },
  { key: "titel", label: "Titel" },
  { key: "vorname", label: "Vorname" },
  { key: "nachname", label: "Nachname" },
  {
    key: "geburtsdatum",
    label: "Geburtsdatum",
    format: (v) => formatDateDE(v as Date | null),
  },
  { key: "strasse", label: "Straße" },
  { key: "hausnummer", label: "Hausnummer" },
  { key: "plz", label: "PLZ" },
  { key: "ort", label: "Ort" },
  { key: "telefon", label: "Telefon" },
  { key: "email", label: "E-Mail" },
  { key: "eintritt", label: "Eintritt", format: (v) => formatDateDE(v as Date | null) },
  { key: "austritt", label: "Austritt", format: (v) => formatDateDE(v as Date | null) },
  {
    key: "verstorbenAm",
    label: "Verstorben am",
    format: (v) => formatDateDE(v as Date | null),
  },
  { key: "aktivPasiv", label: "Aktiv/Passiv" },
];

export const reportsRouter = {
  abteilungenList: authedProc
    .input(v.void())
    .handler(async ({ context }) =>
      cached(context.tenant.key, CACHE_NS.abteilungen, "reports-list", 300, () =>
        context.db
          .select({ id: abteilungenTable.id, name: abteilungenTable.name })
          .from(abteilungenTable)
          .orderBy(asc(abteilungenTable.name)),
      ),
    ),

  membersExport: authedProc.input(MemberExportInput).handler(async ({ context, input }) => {
    // Explicit-selection export: filter purely by the given ids.
    if (input.ids && input.ids.length > 0) {
      const ids = [...new Set(input.ids)];
      const selected: MemberExportRow[] = await context.db
        .select({
          mitgliedsnummer: sql<string>`coalesce(${membersTable.memberNo}, ${membersTable.kontaktNo}, ${membersTable.mitgliedsnummer}, 'A' || ${membersTable.adrNr})`,
          anrede: membersTable.anrede,
          titel: membersTable.titel1,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          geburtsdatum: membersTable.geburtsdatum,
          strasse: membersTable.strasse,
          hausnummer: membersTable.hausnummer,
          plz: membersTable.plz,
          ort: membersTable.ort,
          telefon: membersTable.telefon1,
          email: membersTable.email,
          eintritt: membersTable.eintritt,
          austritt: membersTable.austritt,
          verstorbenAm: membersTable.verstorbenAm,
          aktivPasiv: aktivPasivLabel(),
        })
        .from(membersTable)
        .where(and(inArray(membersTable.id, ids), memberNotDeleted()))
        .orderBy(asc(membersTable.nachname), asc(membersTable.vorname));
      const stamp = new Date().toISOString().slice(0, 10);
      return {
        filename: `mitglieder-auswahl-${stamp}.csv`,
        content: toCsv(selected, MEMBER_EXPORT_COLUMNS),
      };
    }

    const conditions = buildMemberWhereClauses(input);

    if (input.abteilungId) {
      const idRows = await context.db
        .select({ memberId: memberAbteilungenTable.memberId })
        .from(memberAbteilungenTable)
        .where(eq(memberAbteilungenTable.abteilungId, input.abteilungId));
      const ids = idRows.map((r) => r.memberId);
      if (ids.length === 0) {
        return { filename: "mitglieder.csv", content: toCsv([], MEMBER_EXPORT_COLUMNS) };
      }
      conditions.push(inArray(membersTable.id, ids) as never);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows: MemberExportRow[] = await context.db
      .select({
        mitgliedsnummer: sql<string>`coalesce(${membersTable.memberNo}, ${membersTable.kontaktNo}, ${membersTable.mitgliedsnummer}, 'A' || ${membersTable.adrNr})`,
        anrede: membersTable.anrede,
        titel: membersTable.titel1,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        geburtsdatum: membersTable.geburtsdatum,
        strasse: membersTable.strasse,
        hausnummer: membersTable.hausnummer,
        plz: membersTable.plz,
        ort: membersTable.ort,
        telefon: membersTable.telefon1,
        email: membersTable.email,
        eintritt: membersTable.eintritt,
        austritt: membersTable.austritt,
        verstorbenAm: membersTable.verstorbenAm,
        // Derived aktiv/passiv (real Abteilung), matching the selection export
        // and the member badge. The stored `status` column is stale.
        aktivPasiv: aktivPasivLabel(),
      })
      .from(membersTable)
      .where(where)
      .orderBy(asc(membersTable.nachname), asc(membersTable.vorname));

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `mitglieder-${stamp}.csv`,
      content: toCsv(rows, MEMBER_EXPORT_COLUMNS),
    };
  }),

  geburtstage: authedProc.input(GeburtstageInput).handler(async ({ context, input }) => {
    return loadGeburtstage(context.db, input);
  }),

  geburtstageExport: authedProc.input(GeburtstageInput).handler(async ({ context, input }) => {
    const data = await loadGeburtstage(context.db, input);
    const content = toCsv(data.rows, [
      { key: "mitgliedsnummer", label: "Mitgl.-Nr.", format: (_v, row) => memberRef(row) },
      { key: "nachname", label: "Nachname" },
      { key: "vorname", label: "Vorname" },
      {
        key: "geburtsdatum",
        label: "Geburtsdatum",
        format: (v) => formatDateDE(v as Date | null),
      },
      { key: "alter", label: "Alter im Jahr" },
      { key: "rund", label: "Runder Geburtstag", format: (v) => (v ? "ja" : "nein") },
      { key: "ort", label: "Ort" },
    ] satisfies CsvColumn<BirthdayRow>[]);
    return {
      filename: `geburtstage-${data.year}-${String(data.month).padStart(2, "0")}.csv`,
      content,
    };
  }),

  ehrungen: authedProc.input(EhrungenInput).handler(async ({ context, input }) => {
    return loadEhrungen(context.db, input);
  }),

  ehrungenExport: authedProc.input(EhrungenInput).handler(async ({ context, input }) => {
    const data = await loadEhrungen(context.db, input);
    type FlatRow = {
      jubilaeum: number;
      mitgliedsnummer: string | null;
      nachname: string | null;
      vorname: string | null;
      ort: string | null;
      eintritt: Date;
      jubilaeumsDatum: Date;
    };
    const flat: FlatRow[] = data.groups.flatMap((g) =>
      g.members.map((m) => ({
        jubilaeum: g.jubilee,
        mitgliedsnummer: memberRef(m),
        nachname: m.nachname,
        vorname: m.vorname,
        ort: m.ort,
        eintritt: m.eintritt,
        jubilaeumsDatum: m.jubilaeumsDatum,
      })),
    );
    const content = toCsv(flat, [
      { key: "jubilaeum", label: "Jubiläum (Jahre)" },
      { key: "mitgliedsnummer", label: "Mitgl.-Nr." },
      { key: "nachname", label: "Nachname" },
      { key: "vorname", label: "Vorname" },
      { key: "ort", label: "Ort" },
      { key: "eintritt", label: "Eintritt", format: (v) => formatDateDE(v as Date | null) },
      {
        key: "jubilaeumsDatum",
        label: "Jubiläumsdatum",
        format: (v) => formatDateDE(v as Date | null),
      },
    ] satisfies CsvColumn<FlatRow>[]);
    return { filename: `ehrungen-${data.year}.csv`, content };
  }),

  abteilungStats: vorstandProc.input(YearInput).handler(async ({ context, input }) => {
    return loadAbteilungStats(context.db, input);
  }),

  abteilungStatsExport: vorstandProc.input(YearInput).handler(async ({ context, input }) => {
    const data = await loadAbteilungStats(context.db, input);
    const content = toCsv(data.rows, [
      { key: "name", label: "Abteilung" },
      { key: "aktivCount", label: "Aktive" },
      { key: "joiners", label: "Eintritte im Jahr" },
      { key: "leavers", label: "Austritte im Jahr" },
    ] satisfies CsvColumn<AbteilungStatRow>[]);
    return { filename: `abteilungsstatistik-${data.year}.csv`, content };
  }),

  finanzbericht: vorstandProc.input(YearInput).handler(async ({ context, input }) => {
    return loadFinanzbericht(context.db, input);
  }),

  finanzberichtExport: vorstandProc.input(YearInput).handler(async ({ context, input }) => {
    const data = await loadFinanzbericht(context.db, input);
    const totalsCsv = toCsv(
      [
        { label: "Soll gesamt", value: data.totals.billed },
        { label: "Bezahlt gesamt", value: data.totals.paid },
        { label: "Offen gesamt", value: data.totals.open },
        { label: "Posten gesamt", value: String(data.totals.count) },
      ],
      [
        { key: "label", label: "Kennzahl" },
        { key: "value", label: "Wert" },
      ],
    );
    const abteilungCsv = toCsv(data.perAbteilung, [
      { key: "abteilung", label: "Abteilung" },
      { key: "count", label: "Posten" },
      { key: "billed", label: "Soll" },
      { key: "paid", label: "Bezahlt" },
      { key: "open", label: "Offen" },
    ]);
    const feeTypeCsv = toCsv(data.perFeeType, [
      { key: "art", label: "Beitragsart-ID" },
      { key: "bezeichnung", label: "Beitragsart" },
      { key: "count", label: "Posten" },
      { key: "billed", label: "Soll" },
      { key: "paid", label: "Bezahlt" },
      { key: "open", label: "Offen" },
    ]);
    return {
      filename: `finanzbericht-${data.year}.csv`,
      content: [totalsCsv, abteilungCsv, feeTypeCsv].join("\r\n"),
    };
  }),
};
