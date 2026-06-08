import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";
import { diffSnapshotVsCurrent } from "~/server/snapshots/diff";
import { loadSnapshot, takeMemberSnapshot } from "~/server/snapshots/snapshot";

/**
 * Columns we never overwrite during a restore. `id` would orphan FK
 * references; `created_at` is historical truth; `updated_at` is recomputed
 * to mark the restore moment.
 */
const NON_RESTORABLE_FIELDS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "lastImportedAt",
  "importBatchId",
  // Identifiers and soft-delete state are lifecycle-owned, not field-restorable.
  // Restoring a stale member_no/kontakt_no could collide with a number since
  // reused by another live member (the unique indexes are partial on
  // deletedAt IS NULL); restoring adr_nr would desync the member from its
  // contracts/SEPA/relationships and the next import; restoring deletedAt could
  // silently (un)delete a live member.
  "memberNo",
  "kontaktNo",
  "adrNr",
  "deletedAt",
]);

function buildRestorePatch(snapshotMember: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snapshotMember)) {
    if (NON_RESTORABLE_FIELDS.has(k)) continue;
    patch[k] = coerce(k, v);
  }
  patch.updatedAt = new Date();
  return patch;
}

const DATE_HINT_KEYS = new Set([
  "geburtsdatum",
  "eintritt",
  "austritt",
  "verstorbenAm",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "lastImportedAt",
  "vertragBegin",
  "vertragEnde",
  "gekuendAm",
  "gekuendZum",
  "frueGekuendAm",
  "frueGekuendZum",
  "falligkeitDatum1",
  "falligkeitDatum2",
  "falligkeitDatum3",
  "falligkeitDatum4",
  "angelegtAm",
  "gultigBis",
  "unterschriftDatum",
  "ersteVerwendung",
  "letzteVerwendung",
  "widerrufenAm",
  "gueltigAb",
  "letzteVerwendungAlt",
  "gultigBisAlt",
  "uploadedAt",
  "datVon",
  "datBis",
]);

function coerce(key: string, value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string" && DATE_HINT_KEYS.has(key)) {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return value;
}

async function loadCurrentDependents(tx: DBOrTx, memberId: string) {
  const [contracts, sepa, attachments, relationships, memberAbteilungen, sollstellungen] =
    await Promise.all([
      tx.select().from(contractsTable).where(eq(contractsTable.memberId, memberId)),
      tx.select().from(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, memberId)),
      tx.select().from(attachmentsTable).where(eq(attachmentsTable.memberId, memberId)),
      tx.select().from(relationshipsTable).where(eq(relationshipsTable.fromMemberId, memberId)),
      tx.select().from(memberAbteilungenTable).where(eq(memberAbteilungenTable.memberId, memberId)),
      tx.select().from(sollStellungenTable).where(eq(sollStellungenTable.memberId, memberId)),
    ]);
  return {
    contracts: contracts as Record<string, unknown>[],
    sepa: sepa as Record<string, unknown>[],
    attachments: attachments as Record<string, unknown>[],
    relationships: relationships as Record<string, unknown>[],
    memberAbteilungen: memberAbteilungen as Record<string, unknown>[],
    sollstellungen: sollstellungen as Record<string, unknown>[],
  };
}

/**
 * Replace dependent rows for a member: delete all current rows in each
 * table where memberId matches, then re-insert the snapshot's rows after
 * coercing date strings back to Date. Skipped tables: attachments (file
 * blobs live in S3 and a restore can't materialize them back); fee_run
 * items / sollstellungen (re-insert can violate the unique
 * `(contract, year)` constraint and re-introduce postings the user may
 * have intentionally settled). We snapshot them so the data is preserved,
 * but restore is opt-in.
 */
async function restoreDependents(
  tx: DBOrTx,
  memberId: string,
  snapshot: {
    contracts: Record<string, unknown>[];
    sepa: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    memberAbteilungen: Record<string, unknown>[];
  },
) {
  await tx.delete(contractsTable).where(eq(contractsTable.memberId, memberId));
  await tx.delete(sepaMandatesTable).where(eq(sepaMandatesTable.memberId, memberId));
  await tx.delete(relationshipsTable).where(eq(relationshipsTable.fromMemberId, memberId));
  await tx.delete(memberAbteilungenTable).where(eq(memberAbteilungenTable.memberId, memberId));

  if (snapshot.contracts.length > 0) {
    await tx.insert(contractsTable).values(snapshot.contracts.map((r) => coerceRow(r)) as never);
  }
  if (snapshot.sepa.length > 0) {
    await tx.insert(sepaMandatesTable).values(snapshot.sepa.map((r) => coerceRow(r)) as never);
  }
  if (snapshot.relationships.length > 0) {
    await tx
      .insert(relationshipsTable)
      .values(snapshot.relationships.map((r) => coerceRow(r)) as never);
  }
  if (snapshot.memberAbteilungen.length > 0) {
    await tx
      .insert(memberAbteilungenTable)
      .values(snapshot.memberAbteilungen.map((r) => coerceRow(r)) as never);
  }
}

function coerceRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = coerce(k, v);
  return out;
}

const TriggerSchema = v.picklist(["mutation", "nightly", "manual", "pre_restore", "pre_import"]);

export const snapshotsRouter = {
  /**
   * Metadata-only history for the per-member Versionen tab. Cheap; doesn't
   * pull the JSONB blobs.
   */
  listForMember: authedProc
    .input(
      v.object({
        memberId: v.string(),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
        cursor: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const where = input.cursor
        ? and(
            eq(memberSnapshotsTable.memberId, input.memberId),
            lt(memberSnapshotsTable.createdAt, new Date(input.cursor)),
          )
        : eq(memberSnapshotsTable.memberId, input.memberId);
      const rows = await context.db
        .select({
          id: memberSnapshotsTable.id,
          createdAt: memberSnapshotsTable.createdAt,
          trigger: memberSnapshotsTable.trigger,
          actorEmail: memberSnapshotsTable.actorEmail,
          byteSize: memberSnapshotsTable.byteSize,
          contentHash: memberSnapshotsTable.contentHash,
          auditId: memberSnapshotsTable.auditId,
          runId: memberSnapshotsTable.runId,
          notes: memberSnapshotsTable.notes,
        })
        .from(memberSnapshotsTable)
        .where(where)
        .orderBy(desc(memberSnapshotsTable.createdAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const last = items[items.length - 1];
      return {
        rows: items,
        nextCursor: hasMore && last ? last.createdAt.toISOString() : null,
      };
    }),

  /**
   * Full snapshot payload + diff against the current live state. Vorstand+
   * only because the blob may contain the cleartext IBAN.
   */
  get: vorstandProc
    .input(v.object({ snapshotId: v.string() }))
    .handler(async ({ context, input }) => {
      const snap = await loadSnapshot(context.db, input.snapshotId);
      if (!snap) throw new ORPCError("NOT_FOUND", { message: "Snapshot nicht gefunden." });

      const [currentMember] = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, snap.memberId))
        .limit(1);
      const current = currentMember
        ? {
            member: currentMember as unknown as Record<string, unknown>,
            ...(await loadCurrentDependents(context.db, snap.memberId)),
          }
        : null;

      const diffPayload = current
        ? diffSnapshotVsCurrent(
            {
              member: snap.member,
              contracts: snap.contracts,
              sepa: snap.sepa,
              attachments: snap.attachments,
              relationships: snap.relationships,
              memberAbteilungen: snap.memberAbteilungen,
              sollstellungen: snap.sollstellungen,
            },
            current,
          )
        : null;

      return {
        snapshot: {
          id: snap.id,
          memberId: snap.memberId,
          createdAt: snap.createdAt,
          trigger: snap.trigger,
          actorEmail: snap.actorEmail,
          notes: snap.notes,
          byteSize: snap.byteSize,
          contentHash: snap.contentHash,
          runId: snap.runId,
          member: snap.member,
          contracts: snap.contracts,
          sepa: snap.sepa,
          attachments: snap.attachments,
          relationships: snap.relationships,
          memberAbteilungen: snap.memberAbteilungen,
          sollstellungen: snap.sollstellungen,
        },
        diffVsCurrent: diffPayload,
        memberDeleted: !currentMember,
      };
    }),

  takeManual: vorstandProc
    .input(v.object({ memberId: v.string(), notes: v.optional(v.nullable(v.string()), null) }))
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        return takeMemberSnapshot(tx, input.memberId, {
          trigger: "manual",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          notes: input.notes ?? null,
        });
      });
      if (!result.snapshotId) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }
      return { snapshotId: result.snapshotId };
    }),

  /**
   * Restore the entire member row (and optionally its dependent rows) to
   * the state captured in a snapshot. Always takes a `pre_restore`
   * snapshot of the current state first so the restore is itself
   * reversible.
   */
  restoreMember: vorstandProc
    .input(
      v.object({
        snapshotId: v.string(),
        includeDependents: v.optional(v.boolean(), false),
        dryRun: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const snap = await loadSnapshot(tx, input.snapshotId);
        if (!snap) throw new ORPCError("NOT_FOUND", { message: "Snapshot nicht gefunden." });

        const [current] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, snap.memberId))
          .limit(1);
        if (!current) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht mehr vorhanden." });
        }

        const currentDeps = await loadCurrentDependents(tx, snap.memberId);
        const diffPayload = diffSnapshotVsCurrent(
          {
            member: snap.member,
            contracts: snap.contracts,
            sepa: snap.sepa,
            attachments: snap.attachments,
            relationships: snap.relationships,
            memberAbteilungen: snap.memberAbteilungen,
            sollstellungen: snap.sollstellungen,
          },
          { member: current as unknown as Record<string, unknown>, ...currentDeps },
        );

        if (input.dryRun) {
          return { applied: false, diff: diffPayload, snapshotId: input.snapshotId };
        }

        await takeMemberSnapshot(tx, snap.memberId, {
          trigger: "pre_restore",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          notes: `Vor Wiederherstellung aus ${snap.id}`,
        });

        const patch = buildRestorePatch(snap.member);
        await tx
          .update(membersTable)
          .set(patch as never)
          .where(eq(membersTable.id, snap.memberId));

        if (input.includeDependents) {
          await restoreDependents(tx, snap.memberId, {
            contracts: snap.contracts,
            sepa: snap.sepa,
            relationships: snap.relationships,
            memberAbteilungen: snap.memberAbteilungen,
          });
        }

        const auditChanges: Record<string, { before: unknown; after: unknown }> = {
          ...diffPayload.member,
          __meta: {
            before: null,
            after: {
              kind: "restoreMember",
              snapshotId: snap.id,
              snapshotCreatedAt: snap.createdAt.toISOString(),
              includeDependents: input.includeDependents,
            },
          },
        };
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: snap.memberId,
          action: "restore",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: auditChanges,
          requestId: context.requestId ?? null,
        });

        await takeMemberSnapshot(tx, snap.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
          notes: `Wiederhergestellt aus ${snap.id}`,
        });

        return { applied: true, diff: diffPayload, snapshotId: input.snapshotId };
      });

      await invalidateMemberCaches();
      return result;
    }),

  /**
   * Cherry-pick a single field: write the snapshot's value for one column
   * back to the live row. Dependents are never touched.
   */
  restoreField: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        snapshotId: v.string(),
        fieldName: v.string(),
        dryRun: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      if (NON_RESTORABLE_FIELDS.has(input.fieldName)) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: `Feld '${input.fieldName}' kann nicht zurückgesetzt werden.`,
        });
      }
      const result = await context.db.transaction(async (tx) => {
        const snap = await loadSnapshot(tx, input.snapshotId);
        if (!snap || snap.memberId !== input.memberId) {
          throw new ORPCError("NOT_FOUND", { message: "Snapshot nicht gefunden." });
        }
        const [current] = await tx
          .select()
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!current) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        if (!(input.fieldName in (snap.member as Record<string, unknown>))) {
          throw new ORPCError("VALIDATION_FAILED", {
            message: `Feld '${input.fieldName}' ist im Snapshot nicht vorhanden.`,
          });
        }
        const before = (current as unknown as Record<string, unknown>)[input.fieldName];
        const targetRaw = (snap.member as Record<string, unknown>)[input.fieldName];
        const after = coerce(input.fieldName, targetRaw);
        if (input.dryRun) {
          return { applied: false, before, after };
        }
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "pre_restore",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          notes: `Vor Feld-Wiederherstellung ${input.fieldName} aus ${snap.id}`,
        });
        await tx
          .update(membersTable)
          .set({ [input.fieldName]: after, updatedAt: new Date() } as never)
          .where(eq(membersTable.id, input.memberId));
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "restore",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            [input.fieldName]: { before: before ?? null, after: after ?? null },
            __meta: {
              before: null,
              after: {
                kind: "restoreField",
                snapshotId: snap.id,
                fieldName: input.fieldName,
              },
            },
          },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
        return { applied: true, before, after };
      });
      await invalidateMemberCaches();
      return result;
    }),

  listRuns: adminProc
    .input(
      v.object({
        trigger: v.optional(v.nullable(TriggerSchema), null),
        limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 30),
        cursor: v.optional(v.nullable(v.string()), null),
      }),
    )
    .handler(async ({ context, input }) => {
      const conds = [] as ReturnType<typeof eq>[];
      if (input.trigger) conds.push(eq(snapshotRunsTable.trigger, input.trigger) as never);
      if (input.cursor)
        conds.push(lt(snapshotRunsTable.startedAt, new Date(input.cursor)) as never);
      const where = conds.length > 0 ? and(...conds) : undefined;
      const rows = await context.db
        .select()
        .from(snapshotRunsTable)
        .where(where)
        .orderBy(desc(snapshotRunsTable.startedAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const last = items[items.length - 1];
      return {
        rows: items,
        nextCursor: hasMore && last ? last.startedAt.toISOString() : null,
      };
    }),

  /**
   * List the per-member snapshots produced by one run. Used to populate
   * the bulk-restore picker.
   */
  getRun: adminProc.input(v.object({ runId: v.string() })).handler(async ({ context, input }) => {
    const [run] = await context.db
      .select()
      .from(snapshotRunsTable)
      .where(eq(snapshotRunsTable.id, input.runId))
      .limit(1);
    if (!run) throw new ORPCError("NOT_FOUND", { message: "Snapshot-Run nicht gefunden." });

    const rows = await context.db
      .select({
        id: memberSnapshotsTable.id,
        memberId: memberSnapshotsTable.memberId,
        createdAt: memberSnapshotsTable.createdAt,
        byteSize: memberSnapshotsTable.byteSize,
        contentHash: memberSnapshotsTable.contentHash,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
        adrNr: membersTable.adrNr,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
      })
      .from(memberSnapshotsTable)
      .innerJoin(membersTable, eq(membersTable.id, memberSnapshotsTable.memberId))
      .where(eq(memberSnapshotsTable.runId, input.runId))
      .orderBy(asc(membersTable.nachname), asc(membersTable.vorname));
    return { run, snapshots: rows };
  }),

  /**
   * Bulk-restore selected members from snapshots that belong to one run.
   * Per-member failures are reported in the response — the whole batch
   * does not abort.
   */
  bulkRestore: adminProc
    .input(
      v.object({
        snapshotRunId: v.string(),
        memberIds: v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(500)),
        includeDependents: v.optional(v.boolean(), false),
        dryRun: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      const snapshots = await context.db
        .select()
        .from(memberSnapshotsTable)
        .where(
          and(
            eq(memberSnapshotsTable.runId, input.snapshotRunId),
            inArray(memberSnapshotsTable.memberId, input.memberIds),
          ),
        );
      const perMember: Array<{
        memberId: string;
        ok: boolean;
        error?: string;
        changedFieldCount?: number;
      }> = [];
      for (const snap of snapshots) {
        try {
          const result = await context.db.transaction(async (tx) => {
            const [current] = await tx
              .select()
              .from(membersTable)
              .where(eq(membersTable.id, snap.memberId))
              .limit(1);
            if (!current) throw new Error("Mitglied existiert nicht mehr.");
            const currentDeps = await loadCurrentDependents(tx, snap.memberId);
            const diffPayload = diffSnapshotVsCurrent(
              {
                member: snap.member,
                contracts: snap.contracts,
                sepa: snap.sepa,
                attachments: snap.attachments,
                relationships: snap.relationships,
                memberAbteilungen: snap.memberAbteilungen,
                sollstellungen: snap.sollstellungen,
              },
              { member: current as unknown as Record<string, unknown>, ...currentDeps },
            );
            if (input.dryRun) {
              return { changedFieldCount: Object.keys(diffPayload.member).length };
            }
            await takeMemberSnapshot(tx, snap.memberId, {
              trigger: "pre_restore",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              notes: `Vor Bulk-Wiederherstellung Run ${input.snapshotRunId}`,
            });
            const patch = buildRestorePatch(snap.member);
            await tx
              .update(membersTable)
              .set(patch as never)
              .where(eq(membersTable.id, snap.memberId));
            if (input.includeDependents) {
              await restoreDependents(tx, snap.memberId, {
                contracts: snap.contracts,
                sepa: snap.sepa,
                relationships: snap.relationships,
                memberAbteilungen: snap.memberAbteilungen,
              });
            }
            const auditId = await appendAudit(tx, {
              entityType: "member",
              entityId: snap.memberId,
              action: "restore",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: {
                ...diffPayload.member,
                __meta: {
                  before: null,
                  after: {
                    kind: "bulkRestore",
                    runId: input.snapshotRunId,
                    snapshotId: snap.id,
                    includeDependents: input.includeDependents,
                  },
                },
              },
              requestId: context.requestId ?? null,
            });
            await takeMemberSnapshot(tx, snap.memberId, {
              trigger: "mutation",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              auditId,
              notes: `Bulk-wiederhergestellt aus ${snap.id}`,
            });
            return { changedFieldCount: Object.keys(diffPayload.member).length };
          });
          perMember.push({
            memberId: snap.memberId,
            ok: true,
            changedFieldCount: result.changedFieldCount,
          });
        } catch (err) {
          perMember.push({
            memberId: snap.memberId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await invalidateMemberCaches();
      return { perMember, applied: !input.dryRun };
    }),
};
