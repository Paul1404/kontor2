import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import type {
  BestandserhebungAgeBucket,
  BestandserhebungBreakdown,
  BestandserhebungCell,
  BestandserhebungGender,
} from "~/server/db/schema/bestandserhebungen";
import { membersTable } from "~/server/db/schema/members";

/**
 * Standard LSB / DOSB age buckets used for Bestandserhebung.
 * Buckets are calendar-year based: `bucketAt(stichtag.year - geburtsdatum.year)`.
 * This matches what every German Landessportbund expects and is documented
 * in the DOSB Bestandserhebungs-Handbuch.
 */
export const LSB_AGE_BUCKETS = [
  { label: "0-6", min: 0, max: 6 },
  { label: "7-14", min: 7, max: 14 },
  { label: "15-18", min: 15, max: 18 },
  { label: "19-26", min: 19, max: 26 },
  { label: "27-40", min: 27, max: 40 },
  { label: "41-60", min: 41, max: 60 },
  { label: "61+", min: 61, max: Number.POSITIVE_INFINITY },
] as const satisfies ReadonlyArray<{
  label: BestandserhebungAgeBucket;
  min: number;
  max: number;
}>;

function ageBucketFor(ageInYears: number | null): BestandserhebungAgeBucket {
  if (ageInYears == null || !Number.isFinite(ageInYears) || ageInYears < 0) return "unbekannt";
  for (const b of LSB_AGE_BUCKETS) {
    if (ageInYears >= b.min && ageInYears <= b.max) return b.label;
  }
  return "unbekannt";
}

function genderFor(value: string | null | undefined): BestandserhebungGender {
  if (value === "m" || value === "w" || value === "d") return value;
  return "unbekannt";
}

export type ComputeBestandserhebungInput = {
  stichtag: string; // ISO date YYYY-MM-DD
  abteilungIds?: string[]; // optional filter
};

/**
 * Aggregate active members per Abteilung × Geschlecht × Altersgruppe at the
 * given Stichtag. "Active" = `eintrittsdatum <= stichtag AND (austrittsdatum
 * IS NULL OR austrittsdatum > stichtag)` for the dept link, AND the member
 * itself is neither verstorben before the Stichtag, nor ausgetreten before
 * it, nor soft-deleted before it.
 *
 * Multiple Abteilungen for the same member each count once per Abteilung —
 * a DOSB count is per-Sparte-pro-Mitglied (Mehrfachmitgliedschaften zählen
 * mehrfach), which is what the LSB Bestandserhebung asks for.
 */
export async function computeBestandserhebung(
  db: DB,
  input: ComputeBestandserhebungInput,
): Promise<BestandserhebungBreakdown> {
  const stichtag = input.stichtag;
  const stichtagYear = Number(stichtag.slice(0, 4));

  const whereAbtFilter = input.abteilungIds?.length
    ? inArray(memberAbteilungenTable.abteilungId, input.abteilungIds)
    : undefined;

  const ageExpr = sql<number | null>`
    case when ${membersTable.geburtsdatum} is null then null
    else ${stichtagYear} - extract(year from ${membersTable.geburtsdatum})::int
    end
  `;

  const rows = await db
    .select({
      memberId: membersTable.id,
      abteilungId: abteilungenTable.id,
      abteilungName: abteilungenTable.name,
      sportart: abteilungenTable.sportart,
      verbandName: abteilungenTable.verbandName,
      verbandNr: abteilungenTable.verbandNr,
      geschlecht: membersTable.geschlecht,
      ageInYears: ageExpr,
    })
    .from(memberAbteilungenTable)
    .innerJoin(membersTable, eq(membersTable.id, memberAbteilungenTable.memberId))
    .innerJoin(abteilungenTable, eq(abteilungenTable.id, memberAbteilungenTable.abteilungId))
    .where(
      and(
        // dept membership active on stichtag
        sql`${memberAbteilungenTable.eintrittsdatum} <= ${stichtag}::date`,
        or(
          isNull(memberAbteilungenTable.austrittsdatum),
          sql`${memberAbteilungenTable.austrittsdatum} > ${stichtag}::date`,
        ),
        // member itself was an active person on stichtag
        or(isNull(membersTable.austritt), sql`${membersTable.austritt} > ${stichtag}::date`),
        or(
          isNull(membersTable.verstorbenAm),
          sql`${membersTable.verstorbenAm} > ${stichtag}::date`,
        ),
        or(isNull(membersTable.deletedAt), sql`${membersTable.deletedAt} > ${stichtag}::date`),
        // Keep the legacy `geloscht` exclusion here even though it is folded
        // into `deletedAt` elsewhere. This check is date-aware (a member
        // deleted after the Stichtag still counted on it), but the fold stamps
        // legacy-deleted members with `deletedAt = now()`, which is after a past
        // Stichtag and would wrongly count them as present. `geloscht` has no
        // date, so it correctly excludes them regardless. This is the one site
        // that must outlive the fold; do not drop it without a real deletion
        // date for legacy-deleted members.
        sql`coalesce(${membersTable.geloscht}, false) = false`,
        whereAbtFilter,
      ),
    );

  // Pre-load every Abteilung so departments with zero members still show up
  // in the result (LSB wants a row per Sparte even if it's 0).
  const allAbteilungen = await db
    .select({
      id: abteilungenTable.id,
      name: abteilungenTable.name,
      sportart: abteilungenTable.sportart,
      verbandName: abteilungenTable.verbandName,
      verbandNr: abteilungenTable.verbandNr,
    })
    .from(abteilungenTable)
    .where(eq(abteilungenTable.inaktiv, false))
    .orderBy(asc(abteilungenTable.name));

  const allowed = input.abteilungIds?.length ? new Set(input.abteilungIds) : null;
  const includedAbteilungen = allowed
    ? allAbteilungen.filter((a) => allowed.has(a.id))
    : allAbteilungen;

  type CellKey = string;
  const cellKey = (
    abtId: string,
    g: BestandserhebungGender,
    b: BestandserhebungAgeBucket,
  ): CellKey => `${abtId}|${g}|${b}`;

  const cellsMap = new Map<CellKey, BestandserhebungCell>();

  // Seed empty cells for every Abteilung × bucket × gender so the matrix is
  // dense — easier to render and to diff later.
  const ALL_BUCKETS = [...LSB_AGE_BUCKETS.map((b) => b.label), "unbekannt"] as const;
  const ALL_GENDERS: BestandserhebungGender[] = ["m", "w", "d", "unbekannt"];
  for (const abt of includedAbteilungen) {
    for (const g of ALL_GENDERS) {
      for (const b of ALL_BUCKETS) {
        cellsMap.set(cellKey(abt.id, g, b), {
          abteilungId: abt.id,
          abteilungName: abt.name,
          sportart: abt.sportart,
          verbandName: abt.verbandName,
          verbandNr: abt.verbandNr,
          gender: g,
          ageBucket: b,
          count: 0,
        });
      }
    }
  }

  // A member can hold more than one active link row in the same Abteilung
  // (e.g. an import sentinel eintrittsdatum plus a real re-join, both with a
  // null austrittsdatum). The official report counts each person once per
  // Sparte, so dedupe on (member, abteilung) before bucketing.
  const countedPerAbteilung = new Set<string>();
  for (const r of rows) {
    const dedupeKey = `${r.memberId}|${r.abteilungId}`;
    if (countedPerAbteilung.has(dedupeKey)) continue;
    countedPerAbteilung.add(dedupeKey);
    const g = genderFor(r.geschlecht);
    const b = ageBucketFor(r.ageInYears);
    const key = cellKey(r.abteilungId, g, b);
    const existing = cellsMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      // Abteilung not in the seeded list (e.g. inactive but historically used)
      cellsMap.set(key, {
        abteilungId: r.abteilungId,
        abteilungName: r.abteilungName,
        sportart: r.sportart,
        verbandName: r.verbandName,
        verbandNr: r.verbandNr,
        gender: g,
        ageBucket: b,
        count: 1,
      });
    }
  }

  const cells = Array.from(cellsMap.values());

  const perAbteilungMap = new Map<string, BestandserhebungBreakdown["perAbteilung"][number]>();
  for (const c of cells) {
    let row = perAbteilungMap.get(c.abteilungId);
    if (!row) {
      row = {
        abteilungId: c.abteilungId,
        abteilungName: c.abteilungName,
        sportart: c.sportart,
        verbandName: c.verbandName,
        verbandNr: c.verbandNr,
        total: 0,
        male: 0,
        female: 0,
        divers: 0,
      };
      perAbteilungMap.set(c.abteilungId, row);
    }
    row.total += c.count;
    if (c.gender === "m") row.male += c.count;
    else if (c.gender === "w") row.female += c.count;
    else if (c.gender === "d") row.divers += c.count;
  }

  const perAbteilung = Array.from(perAbteilungMap.values()).sort((a, b) =>
    a.abteilungName.localeCompare(b.abteilungName, "de"),
  );
  const grandTotal = perAbteilung.reduce((sum, r) => sum + r.total, 0);

  return {
    stichtag,
    cells,
    perAbteilung,
    grandTotal,
  };
}
