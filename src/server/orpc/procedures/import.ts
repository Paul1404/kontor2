import { ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { membersTable } from "~/server/db/schema/members";
import { memberSnapshotsTable, snapshotRunsTable } from "~/server/db/schema/snapshots";
import { runIngest } from "~/server/importer/ingest-pipeline";
import { parseDump, rowToDict } from "~/server/importer/sql-tokenizer";
import { adminProc } from "~/server/orpc/base";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const MAX_BYTES = 50 * 1024 * 1024;

export const importRouter = {
  uploadSqlDump: adminProc
    .input(
      v.object({
        filename: v.string(),
        contentBase64: v.pipe(v.string(), v.minLength(1)),
        forceOverwriteAbteilungLinks: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
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

      const members = (dump.rows.adresse ?? []).map((r) =>
        rowToDict(dump.columns.adresse ?? [], r),
      );
      const feeTypes = (dump.rows.mgart ?? []).map((r) => rowToDict(dump.columns.mgart ?? [], r));
      const contracts = (dump.rows.mgvert ?? []).map((r) =>
        rowToDict(dump.columns.mgvert ?? [], r),
      );
      const sepa = (dump.rows.adrsepa ?? []).map((r) => rowToDict(dump.columns.adrsepa ?? [], r));
      const relationships = (dump.rows.verkn ?? []).map((r) =>
        rowToDict(dump.columns.verkn ?? [], r),
      );
      const inter = (dump.rows.inter ?? []).map((r) => rowToDict(dump.columns.inter ?? [], r));
      const interes = (dump.rows.interes ?? []).map((r) =>
        rowToDict(dump.columns.interes ?? [], r),
      );

      if (
        members.length +
          feeTypes.length +
          contracts.length +
          sepa.length +
          relationships.length +
          interes.length ===
        0
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Keine verarbeitbaren Tabellen im Dump gefunden.",
        });
      }

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

      const result = await runIngest(context.db, {
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
        requestId: context.requestId,
        forceOverwriteAbteilungLinks: input.forceOverwriteAbteilungLinks,
      });
      return { ...result, snapshotRunId, snapshotMemberCount };
    }),
};
