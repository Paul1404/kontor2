import { ORPCError } from "@orpc/server";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { appendAudit, type Changes } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { auditLogTable } from "~/server/db/schema/audit";
import { contractsTable } from "~/server/db/schema/contracts";
import { dsgvoRequestsTable } from "~/server/db/schema/dsgvo";
import { dunningItemsTable } from "~/server/db/schema/dunning";
import { feeRunItemsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { memberSourceRecordsTable } from "~/server/db/schema/member-source-records";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable } from "~/server/db/schema/snapshots";
import { buildScrubRules, earliestErasureDate } from "~/server/dsgvo/policy";

export type ErasureDiffEntry = {
  column: string;
  before: string | null;
  after: string | null;
};

export type ErasureRetention = {
  lastFinancialEventAt: string | null;
  earliestErasureDate: string;
  retentionExpired: boolean;
};

export type ErasurePreview = {
  memberId: string;
  diff: ErasureDiffEntry[];
  retention: ErasureRetention;
};

function valueToString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

async function lastFinancialEventAt(db: DBOrTx, memberId: string): Promise<Date | null> {
  const [feeRow] = await db
    .select({ ts: sql<Date | null>`max(${sollStellungenTable.createdAt})` })
    .from(sollStellungenTable)
    .where(eq(sollStellungenTable.memberId, memberId));
  const [itemRow] = await db
    .select({ ts: sql<Date | null>`max(${feeRunItemsTable.createdAt})` })
    .from(feeRunItemsTable)
    .where(eq(feeRunItemsTable.memberId, memberId));
  const [sepaRow] = await db
    .select({ ts: sql<Date | null>`max(${sepaMandatesTable.letzteVerwendung})` })
    .from(sepaMandatesTable)
    .where(eq(sepaMandatesTable.memberId, memberId));
  const candidates = [feeRow?.ts ?? null, itemRow?.ts ?? null, sepaRow?.ts ?? null].filter(
    (v): v is Date => v != null,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a > b ? a : b));
}

export async function previewErasure(db: DBOrTx, memberId: string): Promise<ErasurePreview> {
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

  const rules = buildScrubRules(memberId);
  const diff: ErasureDiffEntry[] = [];
  for (const [col, rule] of Object.entries(rules)) {
    const before = (member as unknown as Record<string, unknown>)[col];
    const beforeStr = valueToString(before);
    const after = rule.kind === "null" ? null : rule.value;
    if (beforeStr === after) continue;
    diff.push({ column: col, before: beforeStr, after });
  }

  const last = await lastFinancialEventAt(db, memberId);
  const earliest = earliestErasureDate({
    austritt: member.austritt as Date | null,
    verstorbenAm: member.verstorbenAm as Date | null,
    lastFinancialEventAt: last,
  });

  return {
    memberId,
    diff,
    retention: {
      lastFinancialEventAt: last?.toISOString() ?? null,
      earliestErasureDate: earliest.toISOString(),
      retentionExpired: earliest.getTime() <= Date.now(),
    },
  };
}

export type ExecuteErasureOpts = {
  forceOverride?: boolean;
  overrideReason?: string;
  requestId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
};

export type ErasureResult = {
  memberId: string;
  appliedDiff: ErasureDiffEntry[];
  auditId: string | null;
  overridden: boolean;
};

export async function executeErasure(
  db: DBOrTx,
  memberId: string,
  opts: ExecuteErasureOpts = {},
): Promise<ErasureResult> {
  const preview = await previewErasure(db, memberId);
  if (!preview.retention.retentionExpired && !opts.forceOverride) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: `Aufbewahrungsfrist nicht abgelaufen (frühestens ${preview.retention.earliestErasureDate}). Override erforderlich.`,
    });
  }
  if (!preview.retention.retentionExpired && opts.forceOverride && !opts.overrideReason?.trim()) {
    throw new ORPCError("PRECONDITION_FAILED", { message: "Override-Begründung erforderlich." });
  }

  const rules = buildScrubRules(memberId);
  const updates: Record<string, unknown> = {};
  for (const [col, rule] of Object.entries(rules)) {
    updates[col] = rule.kind === "null" ? null : rule.value;
  }
  updates.updatedAt = new Date();

  await db.update(membersTable).set(updates).where(eq(membersTable.id, memberId));

  // Pseudonymizing the members row is not enough: the same personal data is
  // copied into several derived stores. Clear every copy so none survives.

  // 1. Verbatim Linear provenance -- `raw` holds the original dump row in
  //    plaintext (names, address, possibly IBAN).
  const deletedSource = await db
    .delete(memberSourceRecordsTable)
    .where(eq(memberSourceRecordsTable.memberId, memberId))
    .returning({ id: memberSourceRecordsTable.id });

  // 2. Member snapshots store a full JSONB copy of the row at every change.
  const deletedSnapshots = await db
    .delete(memberSnapshotsTable)
    .where(eq(memberSnapshotsTable.memberId, memberId))
    .returning({ id: memberSnapshotsTable.id });

  // 3. Dunning items embed the rendered name/address in JSON plus a Mahnung PDF.
  const deletedDunning = await db
    .delete(dunningItemsTable)
    .where(eq(dunningItemsTable.memberId, memberId))
    .returning({ id: dunningItemsTable.id });

  // 4. Relationship rows carry name/contact/notes in plaintext (the Linear
  //    `verkn` payload). Scrub both directions: rows where this member is the
  //    linked party (`toMemberId`) AND the member's own outgoing rows
  //    (`fromMemberId`), which describe a third party tied to the erased member.
  //    The rows stay so the other side keeps its structural link.
  const scrubbedRels = await db
    .update(relationshipsTable)
    .set({
      name: null,
      nachname: null,
      anrede: null,
      telefon: null,
      email: null,
      fax: null,
      vEmail: null,
      funktion: null,
      notiz: null,
      matchcode: null,
    })
    .where(
      or(
        eq(relationshipsTable.toMemberId, memberId),
        eq(relationshipsTable.fromMemberId, memberId),
      ),
    )
    .returning({ id: relationshipsTable.id });

  // 4b. Contracts hold the alternative account holder's name, account, bank and
  //     full postal address (the `*Kih` / `*V` columns) plus free-text purposes
  //     that can contain names. Null them so an Art. 17 erasure leaves no
  //     bank/third-party PII behind. The row itself stays for financial history.
  const scrubbedContracts = await db
    .update(contractsTable)
    .set({
      ktoInhV: null,
      kontoV: null,
      blzV: null,
      bankV: null,
      abwKontoInh: null,
      strasseKih: null,
      plzKih: null,
      ortKih: null,
      emailKih: null,
      verwZw1: null,
      verwZw2: null,
      verwZw3: null,
      verwZw4: null,
    })
    .where(eq(contractsTable.memberId, memberId))
    .returning({ id: contractsTable.id });

  // The erasure audit entry records WHAT was cleared, never the cleared values
  // -- the before-values are exactly the PII we are removing.
  const changes: Changes = {
    __scrubbedColumns: { before: null, after: preview.diff.map((d) => d.column).join(", ") },
  };
  if (deletedSource.length > 0)
    changes.__sourceRecords = { before: `${deletedSource.length}`, after: null };
  if (deletedSnapshots.length > 0)
    changes.__snapshots = { before: `${deletedSnapshots.length}`, after: null };
  if (deletedDunning.length > 0)
    changes.__dunningItems = { before: `${deletedDunning.length}`, after: null };
  if (scrubbedRels.length > 0)
    changes.__relationships = { before: `${scrubbedRels.length}`, after: null };
  if (scrubbedContracts.length > 0)
    changes.__contracts = { before: `${scrubbedContracts.length}`, after: null };
  if (opts.forceOverride && opts.overrideReason) {
    changes.__override = { before: null, after: opts.overrideReason };
  }

  const auditId = await appendAudit(db, {
    entityType: "member",
    entityId: memberId,
    action: "dsgvo_erasure",
    source: "dsgvo",
    actorId: opts.actorId ?? null,
    actorEmail: opts.actorEmail ?? null,
    changes,
    requestId: opts.requestId ?? null,
  });

  // 5. Redact the personal values still sitting in this member's earlier audit
  //    entries (before/after of past edits). Keep the rows and the erasure
  //    event for accountability; drop only the values.
  await db
    .update(auditLogTable)
    .set({ changes: {} })
    .where(
      and(
        eq(auditLogTable.entityType, "member"),
        eq(auditLogTable.entityId, memberId),
        auditId ? ne(auditLogTable.id, auditId) : undefined,
      ),
    );

  if (opts.requestId) {
    await db
      .update(dsgvoRequestsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        completedBy: opts.actorId ?? null,
      })
      .where(eq(dsgvoRequestsTable.id, opts.requestId));
  }

  return {
    memberId,
    appliedDiff: preview.diff,
    auditId,
    overridden: !!opts.forceOverride && !preview.retention.retentionExpired,
  };
}

/**
 * Quick lookup of the most recent erasure audit entry for a member (for UI:
 * "Anonymisiert am 12.05.2026 durch admin@verein.de").
 */
export async function lastErasureAudit(db: DBOrTx, memberId: string) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.entityId, memberId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(50);
  return rows.find((r) => r.action === "dsgvo_erasure") ?? null;
}
