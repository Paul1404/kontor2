import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";

export type SnapshotTrigger = "mutation" | "nightly" | "manual" | "pre_restore" | "pre_import";

export type TakeSnapshotOptions = {
  trigger: SnapshotTrigger;
  runId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  auditId?: string | null;
  notes?: string | null;
  /**
   * When true and the member's serialized state hashes to the same value as
   * the most recent snapshot for that member, skip the insert. Used by the
   * nightly run to keep storage bounded for members that haven't changed.
   */
  skipIfUnchanged?: boolean;
};

export type TakeSnapshotResult = { snapshotId: string | null; skipped: boolean };

/**
 * Deterministic JSON: sorted keys + ISO-8601 dates so the same in-memory
 * value always hashes to the same string. Dependent arrays are sorted by
 * the row `id` so insertion order doesn't perturb the hash.
 */
function canonicalize(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer?.(value)) return value.toString("base64");
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function sortById<T extends { id?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

/** Stable sort for rows without a surrogate id (member_abteilungen). */
function sortByComposite<
  T extends { memberId?: string; abteilungId?: string; eintrittsdatum?: unknown },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    `${a.memberId}|${a.abteilungId}|${String(a.eintrittsdatum ?? "")}`.localeCompare(
      `${b.memberId}|${b.abteilungId}|${String(b.eintrittsdatum ?? "")}`,
    ),
  );
}

export async function takeMemberSnapshot(
  tx: DBOrTx,
  memberId: string,
  opts: TakeSnapshotOptions,
): Promise<TakeSnapshotResult> {
  const [member] = await tx
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!member) return { snapshotId: null, skipped: true };

  const [contracts, sepa, attachments, relationships, memberAbteilungen, sollstellungen, families] =
    await Promise.all([
      tx.select().from(contractsTable).where(eq(contractsTable.memberId, memberId)),
      tx.select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, memberId)),
      tx.select().from(attachmentsTable).where(eq(attachmentsTable.memberId, memberId)),
      tx.select().from(relationshipsTable).where(eq(relationshipsTable.fromMemberId, memberId)),
      tx.select().from(memberAbteilungenTable).where(eq(memberAbteilungenTable.memberId, memberId)),
      tx.select().from(sollStellungenTable).where(eq(sollStellungenTable.memberId, memberId)),
      tx
        .select({ membership: familienMitgliederTable, family: familienTable })
        .from(familienMitgliederTable)
        .innerJoin(familienTable, eq(familienTable.id, familienMitgliederTable.familieId))
        .where(eq(familienMitgliederTable.memberId, memberId)),
    ]);

  const payload = {
    member: canonicalize(member),
    contracts: canonicalize(sortById(contracts)),
    sepa: canonicalize(sortById(sepa)),
    attachments: canonicalize(sortById(attachments)),
    relationships: canonicalize(sortById(relationships)),
    // member_abteilungen has no `id`; sort by its composite PK so the
    // serialized order (and thus contentHash) is stable across runs.
    // Otherwise skipIfUnchanged sees phantom changes and writes redundant
    // snapshots.
    memberAbteilungen: canonicalize(sortByComposite(memberAbteilungen)),
    sollstellungen: canonicalize(sortById(sollstellungen)),
    families: canonicalize(sortById(families.map((row) => ({ id: row.membership.id, ...row })))),
  };
  const canonicalJson = JSON.stringify(payload);
  const contentHash = sha256Hex(canonicalJson);
  const byteSize = Buffer.byteLength(canonicalJson, "utf8");

  if (opts.skipIfUnchanged) {
    const [latest] = await tx
      .select({ contentHash: memberSnapshotsTable.contentHash })
      .from(memberSnapshotsTable)
      .where(eq(memberSnapshotsTable.memberId, memberId))
      .orderBy(desc(memberSnapshotsTable.createdAt))
      .limit(1);
    if (latest && latest.contentHash === contentHash) {
      return { snapshotId: null, skipped: true };
    }
  }

  let runId = opts.runId ?? null;
  if (!runId) {
    const now = new Date();
    const [run] = await tx
      .insert(snapshotRunsTable)
      .values({
        trigger: opts.trigger,
        startedAt: now,
        finishedAt: now,
        memberCount: 1,
        bytesTotal: byteSize,
        actorId: opts.actorId ?? null,
        actorEmail: opts.actorEmail ?? null,
        notes: opts.notes ?? null,
      })
      .returning({ id: snapshotRunsTable.id });
    runId = run?.id ?? null;
  }

  const [inserted] = await tx
    .insert(memberSnapshotsTable)
    .values({
      runId,
      memberId,
      trigger: opts.trigger,
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
      auditId: opts.auditId ?? null,
      notes: opts.notes ?? null,
      member: payload.member as Record<string, unknown>,
      contracts: payload.contracts as Record<string, unknown>[],
      sepa: payload.sepa as Record<string, unknown>[],
      attachments: payload.attachments as Record<string, unknown>[],
      relationships: payload.relationships as Record<string, unknown>[],
      memberAbteilungen: payload.memberAbteilungen as Record<string, unknown>[],
      sollstellungen: payload.sollstellungen as Record<string, unknown>[],
      families: payload.families as Record<string, unknown>[],
      contentHash,
      byteSize,
    })
    .returning({ id: memberSnapshotsTable.id });

  return { snapshotId: inserted?.id ?? null, skipped: false };
}

/**
 * Read a snapshot row back. Returns just the JSONB payload + metadata; the
 * caller decides how to surface the cleartext IBAN (mask vs. show).
 */
export async function loadSnapshot(tx: DBOrTx, snapshotId: string) {
  const [row] = await tx
    .select()
    .from(memberSnapshotsTable)
    .where(eq(memberSnapshotsTable.id, snapshotId))
    .limit(1);
  return row ?? null;
}
