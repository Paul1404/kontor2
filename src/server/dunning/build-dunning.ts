import { and, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { sepaReturnsTable } from "~/server/db/schema/dunning";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";

export type OpenPosting = {
  sollStellungId: string;
  billingYear: number;
  falligkeitsdatum: string;
  amount: string;
  paidAmount: string;
  openAmount: string;
  status: string;
  mahnstufe: number;
  daysOverdue: number;
  rueckgebuhr: string;
};

export type MemberWithDebt = {
  memberId: string;
  mitglnr: string | null;
  adrNr: number;
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  eMailName: string | null;
  mahnSperre: string | null;
  currentMahnstufe: number;
  postings: OpenPosting[];
  openSum: string;
  daysOverdueMax: number;
};

/**
 * Sum a list of decimal strings, returning a string with cent precision.
 * Done in integer cents to avoid floating-point drift.
 */
export function sumDecimal(values: string[]): string {
  let cents = 0;
  for (const v of values) {
    cents += Math.round(Number.parseFloat(v) * 100);
  }
  return (cents / 100).toFixed(2);
}

/**
 * Pick the right Mahngebühr for the given level. Levels map: 1 ->
 * mahngebuhr1, 2 -> mahngebuhr2, 3 -> mahngebuhr3.
 */
export function mahngebuhrFor(
  level: number,
  org: { mahngebuhr1: string; mahngebuhr2: string; mahngebuhr3: string },
): string {
  if (level <= 1) return org.mahngebuhr1;
  if (level === 2) return org.mahngebuhr2;
  return org.mahngebuhr3;
}

export type LoadOpenParams = {
  /** Only include postings older than this date. Default: today. */
  cutoffDate?: Date;
  /** Filter to members in this set. */
  memberIds?: string[];
  /** Only postings at the given Mahnstufe (0 = noch nicht gemahnt). */
  mahnstufe?: number | null;
};

/**
 * Load all open Sollstellungen older than the cutoff, grouped per member.
 * `mahnSperre` members are returned too so the UI can flag them; commit
 * skips them.
 */
export async function loadOpenPostings(db: DB, params: LoadOpenParams = {}): Promise<MemberWithDebt[]> {
  const cutoff = params.cutoffDate ?? new Date();
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const conditions = [
    or(
      eq(sollStellungenTable.status, "open"),
      eq(sollStellungenTable.status, "returned"),
    ),
    lte(sollStellungenTable.falligkeitsdatum, cutoffStr),
    sql`${sollStellungenTable.openAmount}::numeric > 0`,
  ];
  if (params.memberIds && params.memberIds.length > 0) {
    conditions.push(inArray(sollStellungenTable.memberId, params.memberIds));
  }
  if (typeof params.mahnstufe === "number") {
    conditions.push(eq(sollStellungenTable.mahnstufe, params.mahnstufe));
  }

  const rows = await db
    .select({
      sollStellungId: sollStellungenTable.id,
      memberId: sollStellungenTable.memberId,
      billingYear: sollStellungenTable.billingYear,
      falligkeitsdatum: sollStellungenTable.falligkeitsdatum,
      amount: sollStellungenTable.amount,
      paidAmount: sollStellungenTable.paidAmount,
      openAmount: sollStellungenTable.openAmount,
      status: sollStellungenTable.status,
      mahnstufe: sollStellungenTable.mahnstufe,
      mitglnr: membersTable.mitglnr,
      adrNr: membersTable.adrNr,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
      strasse: membersTable.strasse,
      hausnummer: membersTable.hausnummer,
      plz: membersTable.plz,
      ort: membersTable.ort,
      eMailName: membersTable.eMailName,
      mahnSperre: membersTable.mahnSperre,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(sollStellungenTable.memberId, membersTable.id))
    .where(and(...conditions, sql`coalesce(${membersTable.geloscht}, false) = false`))
    .orderBy(membersTable.nachname, membersTable.vorname, sollStellungenTable.billingYear);

  // Optional Rücklastgebühr sum per Sollstellung (latest return only is
  // probably enough, but summing is safe -- a posting can fail twice).
  const sollIds = rows.map((r) => r.sollStellungId);
  const feesById = new Map<string, number>();
  if (sollIds.length > 0) {
    const returns = await db
      .select({
        sollStellungId: sepaReturnsTable.sollStellungId,
        rueckgebuhr: sepaReturnsTable.rueckgebuhr,
      })
      .from(sepaReturnsTable)
      .where(inArray(sepaReturnsTable.sollStellungId, sollIds));
    for (const r of returns) {
      if (!r.sollStellungId) continue;
      const prev = feesById.get(r.sollStellungId) ?? 0;
      feesById.set(r.sollStellungId, prev + Math.round(Number.parseFloat(r.rueckgebuhr) * 100));
    }
  }

  const byMember = new Map<string, MemberWithDebt>();
  for (const row of rows) {
    const daysOverdue = Math.floor(
      (cutoff.getTime() - new Date(row.falligkeitsdatum).getTime()) / (1000 * 60 * 60 * 24),
    );
    const posting: OpenPosting = {
      sollStellungId: row.sollStellungId,
      billingYear: row.billingYear,
      falligkeitsdatum: row.falligkeitsdatum,
      amount: row.amount,
      paidAmount: row.paidAmount,
      openAmount: row.openAmount,
      status: row.status,
      mahnstufe: row.mahnstufe,
      daysOverdue: Math.max(0, daysOverdue),
      rueckgebuhr: ((feesById.get(row.sollStellungId) ?? 0) / 100).toFixed(2),
    };

    let entry = byMember.get(row.memberId);
    if (!entry) {
      entry = {
        memberId: row.memberId,
        mitglnr: row.mitglnr,
        adrNr: row.adrNr,
        vorname: row.vorname,
        nachname: row.nachname,
        kurzname: row.kurzname,
        firma1: row.firma1,
        strasse: row.strasse,
        hausnummer: row.hausnummer,
        plz: row.plz,
        ort: row.ort,
        eMailName: row.eMailName,
        mahnSperre: row.mahnSperre,
        currentMahnstufe: 0,
        postings: [],
        openSum: "0",
        daysOverdueMax: 0,
      };
      byMember.set(row.memberId, entry);
    }
    entry.postings.push(posting);
    entry.currentMahnstufe = Math.max(entry.currentMahnstufe, posting.mahnstufe);
    entry.daysOverdueMax = Math.max(entry.daysOverdueMax, posting.daysOverdue);
  }

  for (const entry of byMember.values()) {
    entry.openSum = sumDecimal([
      ...entry.postings.map((p) => p.openAmount),
      ...entry.postings.map((p) => p.rueckgebuhr),
    ]);
  }

  return [...byMember.values()].sort((a, b) => {
    const ln = (a.nachname ?? "").localeCompare(b.nachname ?? "", "de");
    if (ln !== 0) return ln;
    return (a.vorname ?? "").localeCompare(b.vorname ?? "", "de");
  });
}

void ne;
