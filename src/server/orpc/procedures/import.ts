import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as v from "valibot";
import { decodeBase64Upload, MIB, maxBase64Length } from "~/server/application/upload-bytes";
import { appendAudit } from "~/server/audit/log";
import { importBatchesTable } from "~/server/db/schema/import-batches";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { runIngest } from "~/server/importer/ingest-pipeline";
import type { LinearRow } from "~/server/importer/linear-mapper";
import { createProgressReporter, readImportProgress } from "~/server/importer/progress";
import { parseDump, rowToDict } from "~/server/importer/sql-tokenizer";
import { importCreatedMemberIds, importTouchedAdrNrs } from "~/server/importer/undo";
import { adminProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const MAX_BYTES = 50 * MIB;
const MAX_MESSAGE = `Datei zu groß. Maximum: ${MAX_BYTES / MIB} MB.`;

export const importRouter = {
  /** Live progress for an in-flight import, keyed by the token the client
   *  generated and passed to `uploadSqlDump`. Polled by the upload UI. */
  progress: adminProc
    .input(v.object({ token: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      return (
        (await readImportProgress(context.tenant.key, input.token)) ?? {
          phase: "",
          processed: 0,
          total: 0,
          percent: 0,
          done: false,
          startedAt: 0,
          updatedAt: 0,
        }
      );
    }),

  uploadSqlDump: adminProc
    .input(
      v.object({
        filename: v.string(),
        contentBase64: v.pipe(v.string(), v.minLength(1), v.maxLength(maxBase64Length(MAX_BYTES))),
        forceOverwriteAbteilungLinks: v.optional(v.boolean(), false),
        /** Opaque token the client also polls `import.progress` with. */
        progressToken: v.optional(v.string()),
      }),
    )
    .handler(async ({ context, input }) => {
      const reporter = createProgressReporter(context.tenant.key, input.progressToken);
      const buf = decodeBase64Upload(input.contentBase64, MAX_BYTES, MAX_MESSAGE);
      const text = buf.toString("utf8");
      if (!/CREATE TABLE|INSERT INTO/i.test(text)) {
        throw new ORPCError("BAD_REQUEST", { message: "Keine SQL-Befehle erkannt." });
      }
      const dump = parseDump(text);

      const dictOf = (table: string): LinearRow[] =>
        (dump.rows[table] ?? []).map((r) => rowToDict(dump.columns[table] ?? [], r));

      const members = dictOf("adresse");
      const feeTypes = dictOf("mgart");
      const contracts = dictOf("mgvert");
      const sepa = dictOf("adrsepa");
      const relationships = dictOf("verkn");
      const inter = dictOf("inter");
      const interes = dictOf("interes");
      const mgsolln = dictOf("mgsolln");
      const mgartdat = dictOf("mgartdat");
      const sportarten = dictOf("sportarten");
      const fachverbaende = dictOf("fachverbaende");
      const lastprot = dictOf("lastprot");
      const lastproth = dictOf("lastproth");
      const lastprots = dictOf("lastprots");
      const lastprotsh = dictOf("lastprotsh");

      if (
        members.length +
          feeTypes.length +
          contracts.length +
          sepa.length +
          relationships.length +
          interes.length +
          mgsolln.length +
          mgartdat.length +
          sportarten.length +
          fachverbaende.length +
          lastprot.length +
          lastproth.length ===
        0
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Keine verarbeitbaren Tabellen im Dump gefunden.",
        });
      }

      // Total work for the progress bar: pre-import snapshots plus every input
      // row the ingest pipeline will touch. The snapshot count is only known
      // after we query existing members below.
      const ingestTotal =
        members.length +
        feeTypes.length +
        contracts.length +
        sepa.length +
        relationships.length +
        interes.length +
        sportarten.length +
        fachverbaende.length +
        mgartdat.length +
        mgsolln.length +
        lastprot.length +
        lastproth.length +
        lastprots.length +
        lastprotsh.length;
      let snapshotPlanned = 0;

      // Pre-import snapshots for every existing member that this dump
      // will touch. One shared snapshot_run row groups them so the admin
      // UI can offer "Undo this import" later. Snapshot failures abort before
      // ingest starts; a partial baseline must never be advertised as undoable.
      let snapshotRunId: string | null = null;
      let snapshotMemberCount = 0;
      try {
        // A partial dump may contain contracts, mandates, relationships or
        // postings without an `adresse` row. Snapshot every member referenced
        // by any imported domain row, not only the address table.
        const incomingAdrNrs = importTouchedAdrNrs([
          ...members,
          ...contracts,
          ...sepa,
          ...relationships,
          ...interes,
          ...mgsolln,
          ...lastprots,
          ...lastprotsh,
        ] as Array<Record<string, unknown>>);
        if (incomingAdrNrs.length > 0) {
          const existing = await context.db
            .select({ id: membersTable.id })
            .from(membersTable)
            .where(inArray(membersTable.adrNr, incomingAdrNrs));
          snapshotPlanned = existing.length;
          const [run] = await context.db
            .insert(snapshotRunsTable)
            .values({
              trigger: "pre_import",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              notes: `Vor Import: ${input.filename}`,
            })
            .returning({ id: snapshotRunsTable.id });
          snapshotRunId = run?.id ?? null;
          if (!snapshotRunId) throw new Error("Vor-Import-Lauf konnte nicht angelegt werden.");
          for (const m of existing) {
            const r = await context.db.transaction(async (tx) =>
              takeMemberSnapshot(tx, m.id, {
                trigger: "pre_import",
                runId: snapshotRunId,
                actorId: context.session!.user.id,
                actorEmail: context.session!.user.email,
              }),
            );
            if (!r.snapshotId) throw new Error(`Snapshot für Mitglied ${m.id} fehlgeschlagen.`);
            snapshotMemberCount += 1;
            reporter.report({
              phase: "Snapshot",
              processed: snapshotMemberCount,
              total: snapshotPlanned + ingestTotal,
            });
          }
          const sizeRows = await context.db
            .select({ byteSize: memberSnapshotsTable.byteSize })
            .from(memberSnapshotsTable)
            .where(eq(memberSnapshotsTable.runId, snapshotRunId));
          const bytesTotal = sizeRows.reduce((sum, r) => sum + (r.byteSize ?? 0), 0);
          await context.db
            .update(snapshotRunsTable)
            .set({ finishedAt: new Date(), memberCount: snapshotMemberCount, bytesTotal })
            .where(eq(snapshotRunsTable.id, snapshotRunId));
        }
      } catch (err) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: `Import abgebrochen. Vor-Import-Sicherung fehlgeschlagen: ${(err as Error).message}`,
        });
      }

      try {
        const result = await runIngest(
          context.db,
          {
            source: "sql_upload",
            filename: input.filename,
            fileSizeBytes: buf.length,
            startedBy: context.session!.user.id,
            startedByEmail: context.session!.user.email,
            members,
            feeTypes,
            contracts,
            sepa,
            relationships,
            inter,
            interes,
            mgsolln,
            mgartdat,
            sportarten,
            fachverbaende,
            lastprot,
            lastproth,
            lastprots,
            lastprotsh,
            requestId: context.requestId,
            forceOverwriteAbteilungLinks: input.forceOverwriteAbteilungLinks,
            onProgress: reporter.report,
            progressBase: snapshotPlanned,
            progressTotal: snapshotPlanned + ingestTotal,
          },
          context.tenant.key,
        );
        if (snapshotRunId) {
          await context.db
            .update(snapshotRunsTable)
            .set({ notes: `Vor Import: ${input.filename}\nImport-Batch: ${result.batchId}` })
            .where(eq(snapshotRunsTable.id, snapshotRunId));
        }
        await reporter.finish();
        return { ...result, snapshotRunId, snapshotMemberCount };
      } catch (err) {
        await reporter.finish({ error: (err as Error).message });
        throw err;
      }
    }),

  /**
   * Hide members created by one SQL import. Existing members are identified by
   * the pre-import run and never touched here; admins restore those separately
   * from the run. Soft deletion is deliberate so an accidental undo remains
   * recoverable from the normal deleted-members view.
   */
  hideCreatedMembers: adminProc
    .input(
      v.object({
        batchId: v.pipe(v.string(), v.uuid()),
        snapshotRunId: v.pipe(v.string(), v.uuid()),
      }),
    )
    .handler(async ({ context, input }) => {
      const [batch] = await context.db
        .select({ id: importBatchesTable.id, source: importBatchesTable.source })
        .from(importBatchesTable)
        .where(eq(importBatchesTable.id, input.batchId))
        .limit(1);
      if (batch?.source !== "sql_upload") {
        throw new ORPCError("NOT_FOUND", { message: "SQL-Import nicht gefunden." });
      }

      const [run] = await context.db
        .select({
          id: snapshotRunsTable.id,
          trigger: snapshotRunsTable.trigger,
          notes: snapshotRunsTable.notes,
        })
        .from(snapshotRunsTable)
        .where(eq(snapshotRunsTable.id, input.snapshotRunId))
        .limit(1);
      if (run?.trigger !== "pre_import" || !run.notes?.includes(`Import-Batch: ${input.batchId}`)) {
        throw new ORPCError("NOT_FOUND", { message: "Vor-Import-Snapshot nicht gefunden." });
      }

      const beforeRows = await context.db
        .select({ memberId: memberSnapshotsTable.memberId })
        .from(memberSnapshotsTable)
        .where(eq(memberSnapshotsTable.runId, input.snapshotRunId));
      const imported = await context.db
        .select({
          id: membersTable.id,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
        })
        .from(membersTable)
        .where(and(eq(membersTable.importBatchId, input.batchId), isNull(membersTable.deletedAt)));
      const createdIds = new Set(
        importCreatedMemberIds(
          imported.map((m) => m.id),
          beforeRows.map((r) => r.memberId),
        ),
      );
      const created = imported.filter((m) => createdIds.has(m.id));
      if (created.length === 0) return { hiddenCount: 0 };

      const now = new Date();
      await context.db.transaction(async (tx) => {
        await tx
          .update(membersTable)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            inArray(
              membersTable.id,
              created.map((m) => m.id),
            ),
          );
        for (const member of created) {
          await appendAudit(tx, {
            entityType: "member",
            entityId: member.id,
            action: "delete",
            source: "import",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes: {
              deletedAt: { before: null, after: now.toISOString() },
              importUndo: {
                before: null,
                after: { batchId: input.batchId, snapshotRunId: input.snapshotRunId },
              },
            },
            requestId: context.requestId ?? null,
          });
        }
      });
      await invalidateMemberCaches(context.tenant.key);
      return { hiddenCount: created.length };
    }),
};
