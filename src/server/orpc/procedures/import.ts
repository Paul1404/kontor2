import * as v from "valibot";
import { ORPCError } from "@orpc/server";
import { adminProc } from "~/server/orpc/base";
import { parseDump, rowToDict } from "~/server/importer/sql-tokenizer";
import { runIngest } from "~/server/importer/ingest-pipeline";

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
      return result;
    }),
};
