import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { authedProc } from "~/server/orpc/base";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { auditLogTable } from "~/server/db/schema/audit";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { getCached, searchCacheKey, setCached } from "~/server/search/cache";

const StatusSchema = v.picklist(["aktiv", "passiv", "ausgetreten", "verstorben", "alle"]);

const ListInput = v.object({
  q: v.optional(v.string(), ""),
  status: v.optional(StatusSchema, "aktiv"),
  abteilungId: v.optional(v.nullable(v.string()), null),
  includeAusgetretene: v.optional(v.boolean(), false),
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
});

export const membersRouter = {
  list: authedProc
    .input(ListInput)
    .handler(async ({ context, input }) => {
      const cacheKey = searchCacheKey(input);
      const cached = await getCached<{ rows: unknown[]; total: number }>(cacheKey);
      if (cached) return cached;

      const conditions = [] as ReturnType<typeof eq>[];

      // Soft-deletion: members with austritt set are "ausgetreten".
      if (!input.includeAusgetretene && input.status !== "ausgetreten") {
        conditions.push(isNull(membersTable.austritt) as never);
      }
      if (input.status === "ausgetreten") {
        conditions.push(isNotNull(membersTable.austritt) as never);
      }
      if (input.status === "verstorben") {
        conditions.push(isNotNull(membersTable.verstorbenAm) as never);
      }
      if (input.status === "aktiv") {
        // Match the dashboard's "Aktive Mitglieder" definition: not exited
        // and not deceased. The Linear `Aktiv` column is a free-form string
        // ("J"/"N"/empty in German source data) and not reliable here.
        conditions.push(isNull(membersTable.verstorbenAm) as never);
      }
      if (input.status === "passiv") {
        conditions.push(
          eq(membersTable.aktivPasiv, "P") as never,
          isNull(membersTable.verstorbenAm) as never,
        );
      }

      if (input.q.trim()) {
        const like = `%${input.q.trim()}%`;
        conditions.push(
          or(
            ilike(membersTable.nachname, like),
            ilike(membersTable.vorname, like),
            ilike(membersTable.mitglnr, like),
            ilike(membersTable.eMailName, like),
            ilike(membersTable.ort, like),
          ) as never,
        );
      }

      let memberIdsByAbt: string[] | null = null;
      if (input.abteilungId) {
        const rows = await context.db
          .select({ memberId: memberAbteilungenTable.memberId })
          .from(memberAbteilungenTable)
          .where(eq(memberAbteilungenTable.abteilungId, input.abteilungId));
        memberIdsByAbt = rows.map((r) => r.memberId);
        if (memberIdsByAbt.length === 0) {
          const empty = { rows: [], total: 0 };
          await setCached(cacheKey, empty);
          return empty;
        }
        conditions.push(inArray(membersTable.id, memberIdsByAbt) as never);
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const offset = (input.page - 1) * input.pageSize;
      const [rows, [totalRow]] = await Promise.all([
        context.db
          .select({
            id: membersTable.id,
            adrNr: membersTable.adrNr,
            mitglnr: membersTable.mitglnr,
            anrede: membersTable.anrede,
            titel: membersTable.titel1,
            vorname: membersTable.vorname,
            nachname: membersTable.nachname,
            plz: membersTable.plz,
            ort: membersTable.ort,
            email: membersTable.eMailName,
            telefon: membersTable.telefon1,
            eintritt: membersTable.eintritt,
            austritt: membersTable.austritt,
            verstorbenAm: membersTable.verstorbenAm,
            aktiv: membersTable.aktiv,
            aktivPasiv: membersTable.aktivPasiv,
            abteilung: membersTable.abteilung,
          })
          .from(membersTable)
          .where(where)
          .orderBy(asc(membersTable.nachname), asc(membersTable.vorname))
          .limit(input.pageSize)
          .offset(offset),
        context.db.select({ c: count() }).from(membersTable).where(where),
      ]);

      const result = { rows, total: totalRow?.c ?? 0 };
      await setCached(cacheKey, result);
      return result;
    }),

  get: authedProc
    .input(v.object({ mitgliedsnummer: v.string() }))
    .handler(async ({ context, input }) => {
      const rows = await context.db
        .select()
        .from(membersTable)
        .where(eq(membersTable.mitglnr, input.mitgliedsnummer))
        .limit(1);
      const m = rows[0];
      if (!m) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const [abteilungen, vertraege, sepa, anhaenge, audit] = await Promise.all([
        context.db
          .select({
            id: abteilungenTable.id,
            name: abteilungenTable.name,
            eintrittsdatum: memberAbteilungenTable.eintrittsdatum,
            austrittsdatum: memberAbteilungenTable.austrittsdatum,
          })
          .from(memberAbteilungenTable)
          .innerJoin(abteilungenTable, eq(abteilungenTable.id, memberAbteilungenTable.abteilungId))
          .where(eq(memberAbteilungenTable.memberId, m.id))
          .orderBy(asc(abteilungenTable.name)),
        context.db
          .select()
          .from(contractsTable)
          .where(eq(contractsTable.memberId, m.id))
          .orderBy(desc(contractsTable.vertragBegin)),
        context.db
          .select()
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.memberId, m.id))
          .orderBy(desc(sepaMandatesTable.angelegtAm)),
        context.db
          .select()
          .from(attachmentsTable)
          .where(eq(attachmentsTable.memberId, m.id))
          .orderBy(desc(attachmentsTable.uploadedAt)),
        context.db
          .select()
          .from(auditLogTable)
          .where(and(eq(auditLogTable.entityType, "member"), eq(auditLogTable.entityId, m.id)))
          .orderBy(desc(auditLogTable.createdAt))
          .limit(50),
      ]);

      // Strip the encrypted IBAN ciphertexts from the response. UI only sees last4.
      const { iban1, iban2, iban3, ...stamm } = m;
      void iban1;
      void iban2;
      void iban3;

      return {
        member: stamm,
        abteilungen,
        vertraege,
        sepa,
        anhaenge: anhaenge.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          uploadedAt: a.uploadedAt,
        })),
        audit,
      };
    }),

  abteilungenList: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        id: abteilungenTable.id,
        name: abteilungenTable.name,
        slug: abteilungenTable.slug,
        count: sql<number>`(select count(*) from ${memberAbteilungenTable} where ${memberAbteilungenTable.abteilungId} = ${abteilungenTable.id})::int`,
      })
      .from(abteilungenTable)
      .orderBy(asc(abteilungenTable.name));
  }),
};
