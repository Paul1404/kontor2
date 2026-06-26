import { and, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { membersTable } from "~/server/db/schema/members";
import { membershipApplicationsTable } from "~/server/db/schema/membership-applications";

/**
 * Dedup detection for membership applications. Scores existing members (and
 * other open applications) against an applicant across several signals, so the
 * same person re-applying (the classic Fischer case: existing member submits a
 * fresh application) is surfaced before a duplicate is created.
 *
 * The IBAN is the hardest signal but lives in the non-deterministic
 * `encryptedText` column, so it cannot be matched in SQL. We prefilter on the
 * plaintext `iban1Last4`, then decrypt the few candidates' full IBAN and compare
 * normalised plaintext. Names/email/PLZ match directly.
 */

export type DuplicateSignalInput = {
  vorname?: string | null;
  nachname?: string | null;
  /** ISO yyyy-mm-dd or a Date; the placeholder 01-01 counts as "unknown". */
  geburtsdatum?: string | Date | null;
  /** Full IBAN (plaintext) if known; otherwise pass ibanLast4. */
  iban?: string | null;
  ibanLast4?: string | null;
  email?: string | null;
  plz?: string | null;
};

export type DuplicateCandidate = {
  kind: "member" | "application";
  id: string;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
  name: string;
  geburtsdatum: string | null;
  ort: string | null;
  plz: string | null;
  score: number;
  reasons: string[];
};

/** Candidates at or above this score are treated as likely duplicates. */
export const DUPLICATE_SCORE_THRESHOLD = 40;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const normIban = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();

/** yyyy-mm-dd, or null. Accepts Date or string. */
function isoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** A Jan-1 date is the Linear/import placeholder, so treat it as unreliable. */
function isPlaceholderDob(iso: string | null): boolean {
  return iso?.endsWith("-01-01") ?? false;
}

export type DuplicateRow = {
  id: string;
  vorname: string | null;
  nachname: string | null;
  geburtsdatum: Date | string | null;
  iban1: string | null;
  iban1Last4: string | null;
  email: string | null;
  plz: string | null;
  ort: string | null;
  memberNo: string | null;
  kontaktNo: string | null;
  mitgliedsnummer: string | null;
};

export function scoreDuplicate(
  input: DuplicateSignalInput,
  row: DuplicateRow,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let total = 0;

  const vor = norm(input.vorname);
  const nach = norm(input.nachname);
  const nameExact =
    vor.length > 0 && nach.length > 0 && norm(row.vorname) === vor && norm(row.nachname) === nach;

  // IBAN: hardest signal. Compare normalised plaintext.
  const wantIban = normIban(input.iban);
  if (wantIban && row.iban1 && normIban(row.iban1) === wantIban) {
    total += 100;
    reasons.push("gleiche IBAN");
  }

  // Email.
  const email = norm(input.email);
  if (email && norm(row.email) === email) {
    total += 70;
    reasons.push("gleiche E-Mail");
  }

  // Name + date of birth.
  if (nameExact) {
    const wantDob = isoDay(input.geburtsdatum ?? null);
    const rowDob = isoDay(row.geburtsdatum ?? null);
    if (wantDob && rowDob && wantDob === rowDob) {
      total += 80;
      reasons.push("Name und Geburtsdatum");
    } else if (!wantDob || !rowDob || isPlaceholderDob(wantDob) || isPlaceholderDob(rowDob)) {
      total += 40;
      reasons.push("Name (Geburtsdatum unsicher)");
    } else {
      total += 20;
      reasons.push("gleicher Name");
    }
    // Name + address.
    const plz = norm(input.plz);
    if (plz && norm(row.plz) === plz) {
      total += 50;
      reasons.push("Name und PLZ");
    }
  }

  return { score: total, reasons };
}

/**
 * Find likely-duplicate members and open applications for an applicant. Returns
 * candidates with score >= threshold, highest first. `exclude` skips the
 * application/member currently being processed.
 */
export async function findDuplicateCandidates(
  db: DB,
  input: DuplicateSignalInput,
  exclude?: { applicationId?: string; memberId?: string },
): Promise<DuplicateCandidate[]> {
  const nach = norm(input.nachname);
  const email = norm(input.email);
  const last4 = (input.iban ? normIban(input.iban).slice(-4) : input.ibanLast4) ?? null;
  if (!nach && !email && !last4) return [];

  // Coarse prefilter: any of name / email / iban-last4. Keeps the decrypt set
  // small while not missing a candidate that matches on a single hard signal.
  const memberOr: SQL[] = [];
  if (nach) memberOr.push(sql`lower(${membersTable.nachname}) = ${nach}`);
  if (email) memberOr.push(sql`lower(${membersTable.email}) = ${email}`);
  if (last4) memberOr.push(eq(membersTable.iban1Last4, last4));

  const memberRows = memberOr.length
    ? await db
        .select({
          id: membersTable.id,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          geburtsdatum: membersTable.geburtsdatum,
          iban1: membersTable.iban1,
          iban1Last4: membersTable.iban1Last4,
          email: membersTable.email,
          plz: membersTable.plz,
          ort: membersTable.ort,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
        })
        .from(membersTable)
        .where(and(isNull(membersTable.deletedAt), or(...memberOr)))
        .limit(100)
    : [];

  const appOr: SQL[] = [];
  if (nach) appOr.push(sql`lower(${membershipApplicationsTable.nachname}) = ${nach}`);
  if (email) appOr.push(sql`lower(${membershipApplicationsTable.email}) = ${email}`);
  if (last4) appOr.push(eq(membershipApplicationsTable.ibanLast4, last4));

  const appWhere = and(
    or(...appOr),
    // Only open applications are interesting; approved/declined are resolved.
    sql`${membershipApplicationsTable.status} not in ('genehmigt','abgelehnt')`,
    exclude?.applicationId ? ne(membershipApplicationsTable.id, exclude.applicationId) : undefined,
  );
  const appRows = appOr.length
    ? await db
        .select({
          id: membershipApplicationsTable.id,
          vorname: membershipApplicationsTable.vorname,
          nachname: membershipApplicationsTable.nachname,
          geburtsdatum: membershipApplicationsTable.geburtsdatum,
          iban1: membershipApplicationsTable.iban,
          iban1Last4: membershipApplicationsTable.ibanLast4,
          email: membershipApplicationsTable.email,
          plz: membershipApplicationsTable.plz,
          ort: membershipApplicationsTable.ort,
          memberNo: sql<string | null>`null`,
          kontaktNo: sql<string | null>`null`,
          mitgliedsnummer: sql<string | null>`null`,
        })
        .from(membershipApplicationsTable)
        .where(appWhere)
        .limit(100)
    : [];

  const out: DuplicateCandidate[] = [];
  const push = (kind: "member" | "application", row: DuplicateRow) => {
    if (kind === "member" && exclude?.memberId && row.id === exclude.memberId) return;
    const { score: s, reasons } = scoreDuplicate(input, row);
    if (s < DUPLICATE_SCORE_THRESHOLD) return;
    out.push({
      kind,
      id: row.id,
      memberNo: row.memberNo,
      kontaktNo: row.kontaktNo,
      mitgliedsnummer: row.mitgliedsnummer,
      name: [row.vorname, row.nachname]
        .map((x) => (x ?? "").trim())
        .filter(Boolean)
        .join(" "),
      geburtsdatum: isoDay(row.geburtsdatum ?? null),
      ort: row.ort,
      plz: row.plz,
      score: s,
      reasons,
    });
  };
  for (const r of memberRows) push("member", r as DuplicateRow);
  for (const r of appRows) push("application", r as DuplicateRow);
  out.sort((a, b) => b.score - a.score);
  return out;
}
