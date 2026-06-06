import { ORPCError } from "@orpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { auditLogTable } from "~/server/db/schema/audit";
import { dsgvoRequestsTable } from "~/server/db/schema/dsgvo";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { memberSourceRecordsTable } from "~/server/db/schema/member-source-records";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
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
  const [sepaRow] = await db
    .select({ ts: sql<Date | null>`max(${sepaMandatesTable.letzteVerwendung})` })
    .from(sepaMandatesTable)
    .where(eq(sepaMandatesTable.memberId, memberId));
  const candidates = [feeRow?.ts ?? null, sepaRow?.ts ?? null].filter((v): v is Date => v != null);
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

  const before = preview.diff.reduce<Record<string, unknown>>((acc, d) => {
    acc[d.column] = d.before;
    return acc;
  }, {});
  const after = preview.diff.reduce<Record<string, unknown>>((acc, d) => {
    acc[d.column] = d.after;
    return acc;
  }, {});

  await db.update(membersTable).set(updates).where(eq(membersTable.id, memberId));

  // Erase the verbatim Linear provenance too. `member_source_records.raw` holds
  // the original dump row in plaintext (names, address, possibly IBAN), so it
  // must be cleared on erasure -- pseudonymizing the members row alone would
  // leave a full copy of the personal data behind.
  const deletedSource = await db
    .delete(memberSourceRecordsTable)
    .where(eq(memberSourceRecordsTable.memberId, memberId))
    .returning({ id: memberSourceRecordsTable.id });

  const changes = Object.fromEntries(
    Object.keys({ ...before, ...after }).map((k) => [
      k,
      { before: before[k] ?? null, after: after[k] ?? null },
    ]),
  );
  if (deletedSource.length > 0) {
    changes.__sourceRecords = {
      before: `${deletedSource.length} Datensatz/Datensätze`,
      after: null,
    };
  }
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
