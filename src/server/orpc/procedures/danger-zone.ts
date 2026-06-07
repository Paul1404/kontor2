import { ORPCError } from "@orpc/server";
import { and, count, getTableName, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { attachmentsTable, pendingUploadsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { bestandserhebungenTable } from "~/server/db/schema/bestandserhebungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { dsgvoConsentLogTable, dsgvoRequestsTable } from "~/server/db/schema/dsgvo";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { adminProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";

// Confirmation phrases are deliberately not localized: typing a fixed
// German all-caps string forces the user to read the dialog rather than
// muscle-memory-clicking through. Each phrase is unique per action so
// pasting one cannot trigger another.
const PHRASES = {
  deleteOrphanKontakts: "VERWAISTE KONTAKTE LÖSCHEN",
  purgeSoftDeleted: "GELÖSCHTE MITGLIEDER ENDGÜLTIG ENTFERNEN",
  trimAuditLog: "AUDIT LOG KÜRZEN",
  wipeEverything: "ALLES UNWIDERRUFLICH LÖSCHEN",
} as const;

/**
 * Orphan = Kontakt-row (no mitgliedsnummer) with zero relationships pointing
 * to or from it. Per the data model rule: every Kontakt entry should
 * exist solely to be referenced by a Beziehung; without one it's dead
 * weight that the importer left behind.
 */
const orphanKontaktCondition = and(
  isNull(membersTable.mitgliedsnummer),
  isNull(membersTable.deletedAt),
  sql`not exists (
    select 1 from ${relationshipsTable}
    where ${relationshipsTable.fromMemberId} = ${membersTable.id}
       or ${relationshipsTable.toMemberId} = ${membersTable.id}
  )`,
);

export const dangerZoneRouter = {
  /** Counts for every action so the page can render previews without
   * the user having to open each dialog. */
  overview: adminProc.handler(async ({ context }) => {
    const [orphan] = await context.db
      .select({ c: count() })
      .from(membersTable)
      .where(orphanKontaktCondition);
    const [softDeleted] = await context.db
      .select({ c: count() })
      .from(membersTable)
      .where(isNotNull(membersTable.deletedAt));
    const [auditTotal] = await context.db.select({ c: count() }).from(auditLogTable);
    const [memberTotal] = await context.db
      .select({ c: count() })
      .from(membersTable)
      .where(isNull(membersTable.deletedAt));
    return {
      orphanKontakts: orphan?.c ?? 0,
      softDeletedMembers: softDeleted?.c ?? 0,
      auditEntries: auditTotal?.c ?? 0,
      members: memberTotal?.c ?? 0,
    };
  }),

  /** Sample list of orphan Kontakts so the user sees who'd be deleted. */
  previewOrphanKontakts: adminProc.handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: membersTable.id,
        adrNr: membersTable.adrNr,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        firma1: membersTable.firma1,
        ort: membersTable.ort,
      })
      .from(membersTable)
      .where(orphanKontaktCondition)
      .orderBy(membersTable.nachname, membersTable.vorname)
      .limit(50);
    const [total] = await context.db
      .select({ c: count() })
      .from(membersTable)
      .where(orphanKontaktCondition);
    return { total: total?.c ?? 0, sample: rows };
  }),

  deleteOrphanKontakts: adminProc
    .input(v.object({ confirmation: v.string() }))
    .handler(async ({ context, input }) => {
      if (input.confirmation !== PHRASES.deleteOrphanKontakts) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Bestätigungstext stimmt nicht." });
      }
      const result = await context.db.transaction(async (tx) => {
        const targets = await tx
          .select({ id: membersTable.id, adrNr: membersTable.adrNr })
          .from(membersTable)
          .where(orphanKontaktCondition);
        if (targets.length === 0) return { deleted: 0 };
        const ids = targets.map((t) => t.id);
        await tx.delete(membersTable).where(inArray(membersTable.id, ids));
        await appendAudit(tx, {
          entityType: "danger_zone",
          entityId: "delete_orphan_kontakts",
          action: "delete",
          source: "system",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            deletedKontaktCount: { before: targets.length, after: 0 },
            adrNrs: { before: targets.map((t) => t.adrNr), after: null },
          },
        });
        return { deleted: targets.length };
      });
      if (result.deleted > 0) await invalidateMemberCaches();
      return result;
    }),

  previewSoftDeleted: adminProc
    .input(
      v.object({ olderThanDays: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)) }),
    )
    .handler(async ({ context, input }) => {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - input.olderThanDays);
      const rows = await context.db
        .select({
          id: membersTable.id,
          adrNr: membersTable.adrNr,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          deletedAt: membersTable.deletedAt,
        })
        .from(membersTable)
        .where(and(isNotNull(membersTable.deletedAt), lt(membersTable.deletedAt, threshold)))
        .orderBy(membersTable.deletedAt)
        .limit(50);
      const [total] = await context.db
        .select({ c: count() })
        .from(membersTable)
        .where(and(isNotNull(membersTable.deletedAt), lt(membersTable.deletedAt, threshold)));
      return { total: total?.c ?? 0, sample: rows, threshold };
    }),

  purgeSoftDeleted: adminProc
    .input(
      v.object({
        olderThanDays: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)),
        confirmation: v.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.confirmation !== PHRASES.purgeSoftDeleted) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Bestätigungstext stimmt nicht." });
      }
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - input.olderThanDays);
      const result = await context.db.transaction(async (tx) => {
        const targets = await tx
          .select({ id: membersTable.id, adrNr: membersTable.adrNr })
          .from(membersTable)
          .where(and(isNotNull(membersTable.deletedAt), lt(membersTable.deletedAt, threshold)));
        if (targets.length === 0) return { purged: 0 };
        const ids = targets.map((t) => t.id);
        await tx.delete(membersTable).where(inArray(membersTable.id, ids));
        await appendAudit(tx, {
          entityType: "danger_zone",
          entityId: "purge_soft_deleted",
          action: "delete",
          source: "system",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            purgedCount: { before: targets.length, after: 0 },
            olderThanDays: { before: null, after: input.olderThanDays },
            adrNrs: { before: targets.map((t) => t.adrNr), after: null },
          },
        });
        return { purged: targets.length };
      });
      if (result.purged > 0) await invalidateMemberCaches();
      return result;
    }),

  previewAuditTrim: adminProc
    .input(v.object({ olderThanDays: v.pipe(v.number(), v.integer(), v.minValue(30)) }))
    .handler(async ({ context, input }) => {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - input.olderThanDays);
      const [total] = await context.db
        .select({ c: count() })
        .from(auditLogTable)
        .where(lt(auditLogTable.createdAt, threshold));
      const [oldest] = await context.db
        .select({ d: sql<Date>`min(${auditLogTable.createdAt})` })
        .from(auditLogTable);
      return {
        total: total?.c ?? 0,
        threshold,
        oldestEntry: oldest?.d ?? null,
      };
    }),

  trimAuditLog: adminProc
    .input(
      v.object({
        olderThanDays: v.pipe(v.number(), v.integer(), v.minValue(30)),
        confirmation: v.string(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.confirmation !== PHRASES.trimAuditLog) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Bestätigungstext stimmt nicht." });
      }
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - input.olderThanDays);
      // Run the audit append BEFORE the trim so this very entry survives.
      await appendAudit(context.db, {
        entityType: "danger_zone",
        entityId: "trim_audit_log",
        action: "delete",
        source: "system",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          threshold: { before: null, after: threshold.toISOString() },
          olderThanDays: { before: null, after: input.olderThanDays },
        },
      });
      const deleted = await context.db
        .delete(auditLogTable)
        .where(lt(auditLogTable.createdAt, threshold))
        .returning({ id: auditLogTable.id });
      return { deleted: deleted.length };
    }),

  previewWipe: adminProc.handler(async ({ context }) => {
    const tables = [
      ["Mitglieder", membersTable],
      ["Verträge", contractsTable],
      ["SEPA-Mandate", sepaMandatesTable],
      ["Anhänge", attachmentsTable],
      ["Beziehungen", relationshipsTable],
      ["Snapshots", memberSnapshotsTable],
      ["Beitragsläufe", feeRunsTable],
      ["Audit-Einträge", auditLogTable],
      ["DSGVO-Anfragen", dsgvoRequestsTable],
      ["Bestandserhebungen", bestandserhebungenTable],
    ] as const;
    const counts: Array<{ label: string; count: number }> = [];
    for (const [label, table] of tables) {
      const [row] = await context.db.select({ c: count() }).from(table);
      counts.push({ label, count: row?.c ?? 0 });
    }
    return { counts };
  }),

  wipeEverything: adminProc
    .input(v.object({ confirmation: v.string(), confirmationAgain: v.string() }))
    .handler(async ({ context, input }) => {
      if (
        input.confirmation !== PHRASES.wipeEverything ||
        input.confirmationAgain !== PHRASES.wipeEverything
      ) {
        throw new ORPCError("VALIDATION_FAILED", { message: "Bestätigungstext stimmt nicht." });
      }
      // Tables to wipe, ordered so children come before parents (the FK
      // cascades would handle most, but TRUNCATE ... CASCADE is simpler
      // and works the same on Postgres).
      const tables = [
        sollStellungenTable,
        feeRunItemsTable,
        feeRunsTable,
        memberSnapshotsTable,
        snapshotRunsTable,
        dsgvoConsentLogTable,
        dsgvoRequestsTable,
        attachmentsTable,
        pendingUploadsTable,
        sepaMandatesTable,
        contractsTable,
        memberAbteilungenTable,
        relationshipsTable,
        bestandserhebungenTable,
        membersTable,
        auditLogTable,
      ];
      const totalsBefore: Record<string, number> = {};
      for (const t of tables) {
        const [r] = await context.db.select({ c: count() }).from(t);
        totalsBefore[getTableName(t)] = r?.c ?? 0;
      }
      await context.db.transaction(async (tx) => {
        // CASCADE-truncate the lot in one statement so partial state can't
        // be observed by a concurrent read.
        const names = tables.map((t) => sql.identifier(getTableName(t)));
        await tx.execute(sql`truncate ${sql.join(names, sql`, `)} restart identity cascade`);
        // Re-insert the wipe event into the now-empty audit log so there's
        // a permanent record of who pressed the button.
        await appendAudit(tx, {
          entityType: "danger_zone",
          entityId: "wipe_everything",
          action: "delete",
          source: "system",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            totalsBefore: { before: totalsBefore, after: null },
          },
        });
      });
      await invalidateMemberCaches();
      return { wiped: true, totalsBefore };
    }),
};

export const DANGER_PHRASES = PHRASES;
