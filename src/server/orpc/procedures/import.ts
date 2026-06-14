import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { runIngest } from "~/server/importer/ingest-pipeline";
import type { LinearRow } from "~/server/importer/linear-mapper";
import { createProgressReporter, readImportProgress } from "~/server/importer/progress";
import { parseDump, rowToDict } from "~/server/importer/sql-tokenizer";
import { adminProc } from "~/server/orpc/base";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const MAX_BYTES = 50 * 1024 * 1024;

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
        contentBase64: v.pipe(v.string(), v.minLength(1)),
        forceOverwriteAbteilungLinks: v.optional(v.boolean(), false),
        /** Opaque token the client also polls `import.progress` with. */
        progressToken: v.optional(v.string()),
      }),
    )
    .handler(async ({ context, input }) => {
      const reporter = createProgressReporter(context.tenant.key, input.progressToken);
      const buf = Buffer.from(input.contentBase64, "base64");
      if (buf.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Leere Datei." });
      }
      if (buf.length > MAX_BYTES) {
        throw new ORPCError("PAYLOAD_TOO_LARGE", {
          message: `Datei zu groß. Maximum: ${MAX_BYTES / 1024 / 1024} MB.`,
        });
      }
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
      // UI can offer "Undo this import" later. Best-effort: snapshot
      // failures are logged but do not abort the import.
      let snapshotRunId: string | null = null;
      let snapshotMemberCount = 0;
      try {
        const incomingAdrNrs = members
          .map((r) =>
            Number(
              (r as Record<string, unknown>).AdrNr ??
                (r as Record<string, unknown>).adr_nr ??
                (r as Record<string, unknown>).adrNr,
            ),
          )
          .filter((n) => Number.isFinite(n));
        if (incomingAdrNrs.length > 0) {
          const existing = await context.db
            .select({ id: membersTable.id })
            .from(membersTable)
            .where(inArray(membersTable.adrNr, incomingAdrNrs));
          if (existing.length > 0) {
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
            if (snapshotRunId) {
              for (const m of existing) {
                try {
                  const r = await context.db.transaction(async (tx) =>
                    takeMemberSnapshot(tx, m.id, {
                      trigger: "pre_import",
                      runId: snapshotRunId,
                      actorId: context.session!.user.id,
                      actorEmail: context.session!.user.email,
                    }),
                  );
                  if (r.snapshotId) snapshotMemberCount += 1;
                } catch (snapErr) {
                  console.error(
                    `[import] pre-import snapshot for member ${m.id} failed: ${(snapErr as Error).message}`,
                  );
                }
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
                .set({
                  finishedAt: new Date(),
                  memberCount: snapshotMemberCount,
                  bytesTotal,
                })
                .where(eq(snapshotRunsTable.id, snapshotRunId));
            }
          }
        }
      } catch (err) {
        console.error(`[import] pre-import snapshot batch failed: ${(err as Error).message}`);
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
        await reporter.finish();
        return { ...result, snapshotRunId, snapshotMemberCount };
      } catch (err) {
        await reporter.finish({ error: (err as Error).message });
        throw err;
      }
    }),
};
