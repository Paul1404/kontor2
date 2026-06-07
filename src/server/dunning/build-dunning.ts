import { and, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { sepaReturnsTable } from "~/server/db/schema/dunning";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { ageAt, isDunningBlocked, isMinorAt, memberDisplayName } from "~/server/domain/member";

// Canonical homes are now in `~/server/domain/member`. Re-exported here so the
// existing dunning/kulanz/procedure imports and tests keep working unchanged.
export { ageAt, isDunningBlocked, isMinorAt, memberDisplayName };

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
  mitgliedsnummer: string | null;
  adrNr: number;
  vorname: string | null;
  nachname: string | null;
  kurzname: string | null;
  firma1: string | null;
  anrede: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  dunningBlocked: boolean;
  geburtsdatum: Date | string | null;
  vertreterAnrede: string | null;
  vertreterName: string | null;
  vertreterStrasse: string | null;
  vertreterHausnummer: string | null;
  vertreterPlz: string | null;
  vertreterOrt: string | null;
  currentMahnstufe: number;
  postings: OpenPosting[];
  openSum: string;
  daysOverdueMax: number;
};

/** A postal address block as it appears on the Mahnung. */
export type AddressBlock = {
  anrede: string | null;
  name: string;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  /** Guardian email, when known. Only used for email dispatch, not the PDF. */
  email?: string | null;
};

export type ResolvedRecipient = {
  /** Who the letter is addressed to (the member, or their guardian). */
  recipient: AddressBlock;
  isMinor: boolean;
  guardianSource: "connection" | "custom" | null;
  /** A minor with no guardian resolved: still addressed to the member. */
  minorWithoutGuardian: boolean;
  /** Member name shown as "gesetzliche Vertretung von ..." when a guardian. */
  vertretungFor: string | null;
  /**
   * Email to send the Mahnung to: the guardian's address when the letter is
   * addressed to a guardian who has an email on file, otherwise the member's
   * own. Null when neither has one.
   */
  recipientEmail: string | null;
};

/** Trim to a non-empty email, or null. */
function cleanEmail(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v.length > 0 ? v : null;
}

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
 * Re-verify a previously loaded eligible set against the Sollstellungen that
 * are still dunnable (`allowed`), dropping postings and members that are no
 * longer in scope and recomputing `openSum` exactly as `loadOpenPostings`
 * does (open amounts + Rücklastgebühren).
 *
 * `dunning.commit` loads eligibility and renders PDFs before opening its
 * transaction. Under the per-level advisory lock it calls this with the set of
 * postings still at level-1, so a run that committed first is not dunned twice.
 */
export function restrictToDunnable<
  T extends {
    postings: { sollStellungId: string; openAmount: string; rueckgebuhr: string }[];
    openSum: string;
  },
>(members: readonly T[], allowed: ReadonlySet<string>): T[] {
  return members
    .map((m) => {
      const postings = m.postings.filter((p) => allowed.has(p.sollStellungId));
      return {
        ...m,
        postings,
        openSum: sumDecimal([
          ...postings.map((p) => p.openAmount),
          ...postings.map((p) => p.rueckgebuhr),
        ]),
      };
    })
    .filter((m) => m.postings.length > 0);
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

/**
 * Decide how to reopen a Sollstellung that was booked as `eingezogen`
 * (SEPA presumed collected) but is being manually flagged as *not*
 * collected. Returns the update to apply, or `null` if the row is not
 * `eingezogen` and must be left untouched -- a settled (`paid`),
 * cancelled, or already dunnable (`open` / `returned`) posting must never
 * be resurrected or double-counted.
 */
export function planNichtEingezogen(row: {
  status: string;
  amount: string;
}): { status: "open"; paidAmount: "0"; openAmount: string; mahnstufe: 0 } | null {
  if (row.status !== "eingezogen") return null;
  return { status: "open", paidAmount: "0", openAmount: row.amount, mahnstufe: 0 };
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
 * Dunning-blocked members are returned too so the UI can flag them; commit
 * skips them.
 */
export async function loadOpenPostings(
  db: DB,
  params: LoadOpenParams = {},
): Promise<MemberWithDebt[]> {
  const cutoff = params.cutoffDate ?? new Date();
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const conditions = [
    or(eq(sollStellungenTable.status, "open"), eq(sollStellungenTable.status, "returned")),
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
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
      anrede: membersTable.anrede,
      strasse: membersTable.strasse,
      hausnummer: membersTable.hausnummer,
      plz: membersTable.plz,
      ort: membersTable.ort,
      email: membersTable.email,
      dunningBlocked: membersTable.dunningBlocked,
      geburtsdatum: membersTable.geburtsdatum,
      vertreterAnrede: membersTable.vertreterAnrede,
      vertreterName: membersTable.vertreterName,
      vertreterStrasse: membersTable.vertreterStrasse,
      vertreterHausnummer: membersTable.vertreterHausnummer,
      vertreterPlz: membersTable.vertreterPlz,
      vertreterOrt: membersTable.vertreterOrt,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(sollStellungenTable.memberId, membersTable.id))
    .where(
      and(
        ...conditions,
        // Skip soft-deleted members; a deleted member must never receive a
        // Mahnung. The legacy `geloscht` flag is folded into `deletedAt`.
        memberNotDeleted(),
      ),
    )
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
        mitgliedsnummer: row.mitgliedsnummer,
        adrNr: row.adrNr,
        vorname: row.vorname,
        nachname: row.nachname,
        kurzname: row.kurzname,
        firma1: row.firma1,
        anrede: row.anrede,
        strasse: row.strasse,
        hausnummer: row.hausnummer,
        plz: row.plz,
        ort: row.ort,
        email: row.email,
        dunningBlocked: row.dunningBlocked,
        geburtsdatum: row.geburtsdatum,
        vertreterAnrede: row.vertreterAnrede,
        vertreterName: row.vertreterName,
        vertreterStrasse: row.vertreterStrasse,
        vertreterHausnummer: row.vertreterHausnummer,
        vertreterPlz: row.vertreterPlz,
        vertreterOrt: row.vertreterOrt,
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

/**
 * Use the guardian's own postal address when it has one, otherwise fall back
 * to the member's address. Guardians usually live at the same address as the
 * minor, so this keeps the letter deliverable even for connection-based
 * guardians (relationships store no postal address of their own).
 */
function withAddressFallback(guardian: AddressBlock, member: AddressBlock): AddressBlock {
  const hasOwn = !!(guardian.strasse || guardian.plz || guardian.ort);
  if (hasOwn) return guardian;
  return {
    anrede: guardian.anrede,
    name: guardian.name,
    strasse: member.strasse,
    hausnummer: member.hausnummer,
    plz: member.plz,
    ort: member.ort,
    email: guardian.email,
  };
}

/**
 * Decide who a Mahnung is addressed to. Adults (and members with no birthdate)
 * are addressed directly. Minors are addressed to their legal representative:
 * a connection flagged as Vertreter wins, then the custom Vertreter fields on
 * the member; if neither exists the member is addressed directly and flagged
 * via `minorWithoutGuardian` so the UI can warn before sending.
 */
export function resolveRecipient(
  member: MemberWithDebt,
  guardianConnection: AddressBlock | null,
  asOf: Date,
): ResolvedRecipient {
  const memberName = memberDisplayName(member);
  const memberEmail = cleanEmail(member.email);
  const memberAddress: AddressBlock = {
    anrede: member.anrede,
    name: memberName,
    strasse: member.strasse,
    hausnummer: member.hausnummer,
    plz: member.plz,
    ort: member.ort,
    email: memberEmail,
  };

  if (!isMinorAt(member.geburtsdatum, asOf)) {
    return {
      recipient: memberAddress,
      isMinor: false,
      guardianSource: null,
      minorWithoutGuardian: false,
      vertretungFor: null,
      recipientEmail: memberEmail,
    };
  }

  const guardianName = guardianConnection?.name.trim() ?? "";
  if (guardianConnection !== null && guardianName.length > 0) {
    // Prefer the guardian's own email; fall back to the member's so the mail
    // still reaches the household when the guardian has none on file.
    const guardianEmail = cleanEmail(guardianConnection.email);
    return {
      recipient: withAddressFallback(guardianConnection, memberAddress),
      isMinor: true,
      guardianSource: "connection",
      minorWithoutGuardian: false,
      vertretungFor: memberName,
      recipientEmail: guardianEmail ?? memberEmail,
    };
  }

  if (member.vertreterName?.trim()) {
    const custom: AddressBlock = {
      anrede: member.vertreterAnrede,
      name: member.vertreterName.trim(),
      strasse: member.vertreterStrasse,
      hausnummer: member.vertreterHausnummer,
      plz: member.vertreterPlz,
      ort: member.vertreterOrt,
    };
    return {
      recipient: withAddressFallback(custom, memberAddress),
      isMinor: true,
      guardianSource: "custom",
      minorWithoutGuardian: false,
      vertretungFor: memberName,
      // Custom Vertreter fields carry no email, so we use the member's.
      recipientEmail: memberEmail,
    };
  }

  return {
    recipient: memberAddress,
    isMinor: true,
    guardianSource: null,
    minorWithoutGuardian: true,
    vertretungFor: null,
    recipientEmail: memberEmail,
  };
}

/**
 * Load the connection flagged as Vertreter for each of the given members and
 * resolve it to an address block. When the target is itself a member we use
 * its postal address; external contacts contribute only a name (the address
 * falls back to the member's in `resolveRecipient`). First flag per member
 * wins, so callers should keep at most one `istVertreter` per from-member.
 */
export async function loadGuardianConnections(
  db: DB,
  memberIds: string[],
): Promise<Map<string, AddressBlock>> {
  const out = new Map<string, AddressBlock>();
  if (memberIds.length === 0) return out;

  const rows = await db
    .select({
      fromMemberId: relationshipsTable.fromMemberId,
      relName: relationshipsTable.name,
      relNachname: relationshipsTable.nachname,
      relAnrede: relationshipsTable.anrede,
      relEmail: relationshipsTable.email,
      toMemberId: relationshipsTable.toMemberId,
      tVorname: membersTable.vorname,
      tNachname: membersTable.nachname,
      tAnrede: membersTable.anrede,
      tStrasse: membersTable.strasse,
      tHausnummer: membersTable.hausnummer,
      tPlz: membersTable.plz,
      tOrt: membersTable.ort,
      tEmail: membersTable.email,
    })
    .from(relationshipsTable)
    .leftJoin(membersTable, eq(membersTable.id, relationshipsTable.toMemberId))
    .where(
      and(
        inArray(relationshipsTable.fromMemberId, memberIds),
        eq(relationshipsTable.istVertreter, true),
      ),
    );

  for (const r of rows) {
    if (out.has(r.fromMemberId)) continue; // first flag wins
    const name =
      [r.tVorname, r.tNachname].filter(Boolean).join(" ").trim() ||
      (r.relName ?? r.relNachname ?? "").trim();
    if (!name) continue;
    // A linked member contributes its own email; an external contact carries
    // the relationship's email field.
    const email = (r.toMemberId ? cleanEmail(r.tEmail) : null) ?? cleanEmail(r.relEmail);
    out.set(r.fromMemberId, {
      anrede: r.tAnrede ?? r.relAnrede ?? null,
      name,
      strasse: r.toMemberId ? r.tStrasse : null,
      hausnummer: r.toMemberId ? r.tHausnummer : null,
      plz: r.toMemberId ? r.tPlz : null,
      ort: r.toMemberId ? r.tOrt : null,
      email,
    });
  }
  return out;
}

/** Resolve recipients for a batch of members in one query. */
export async function resolveRecipients(
  db: DB,
  members: MemberWithDebt[],
  asOf: Date,
): Promise<Map<string, ResolvedRecipient>> {
  const guardians = await loadGuardianConnections(
    db,
    members.map((m) => m.memberId),
  );
  const out = new Map<string, ResolvedRecipient>();
  for (const m of members) {
    out.set(m.memberId, resolveRecipient(m, guardians.get(m.memberId) ?? null, asOf));
  }
  return out;
}

void ne;
