import { eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { vorstandProc } from "~/server/orpc/base";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { appendAudit, diff } from "~/server/audit/log";

function toDateOrNull(value: string | null | undefined, field: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiges Datum im Feld "${field}": ${value}`,
    });
  }
  return d;
}

const CreateInput = v.object({
  memberId: v.string(),
  mandatsNr: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  status: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
});

const UpdateInput = v.object({
  status: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
  widerrufenAm: v.optional(v.nullable(v.string())),
});

export const sepaRouter = {
  create: vorstandProc.input(CreateInput).handler(async ({ context, input }) => {
    return await context.db.transaction(async (tx) => {
      const [member] = await tx
        .select({ id: membersTable.id, adrNr: membersTable.adrNr })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }

      let mandatsNr = input.mandatsNr?.trim();
      if (!mandatsNr) {
        // Generate `M{seq}` where seq is the next integer suffix not yet
        // used for this member. Keeps the format short and predictable,
        // and avoids collisions with the Linear-imported numeric mandate
        // refs.
        const [maxRow] = await tx
          .select({
            maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
          })
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.memberId, member.id));
        mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
      }

      const values = {
        memberId: member.id,
        adrNr: member.adrNr,
        mandatsNr,
        lastschriftart: input.lastschriftart ?? null,
        typ: input.typ ?? null,
        status: input.status ?? null,
        angelegtAm: new Date(),
        unterschriftDatum: toDateOrNull(input.unterschriftDatum, "Unterschriftsdatum"),
        gueltigAb: toDateOrNull(input.gueltigAb, "Gültig ab"),
        gultigBis: toDateOrNull(input.gultigBis, "Gültig bis"),
      };

      const [row] = await tx
        .insert(sepaMandatesTable)
        .values(values as never)
        .returning({ id: sepaMandatesTable.id });
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      }

      await appendAudit(tx, {
        entityType: "sepa_mandate",
        entityId: row.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(null, values as Record<string, unknown>),
        requestId: context.requestId ?? null,
      });

      return { id: row.id, mandatsNr };
    });
  }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: UpdateInput }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
        }
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ("status" in input.patch) patch.status = input.patch.status ?? null;
        if ("lastschriftart" in input.patch)
          patch.lastschriftart = input.patch.lastschriftart ?? null;
        if ("typ" in input.patch) patch.typ = input.patch.typ ?? null;
        if ("unterschriftDatum" in input.patch)
          patch.unterschriftDatum = toDateOrNull(
            input.patch.unterschriftDatum,
            "Unterschriftsdatum",
          );
        if ("gueltigAb" in input.patch)
          patch.gueltigAb = toDateOrNull(input.patch.gueltigAb, "Gültig ab");
        if ("gultigBis" in input.patch)
          patch.gultigBis = toDateOrNull(input.patch.gultigBis, "Gültig bis");
        if ("widerrufenAm" in input.patch)
          patch.widerrufenAm = toDateOrNull(input.patch.widerrufenAm, "Widerrufen am");

        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };

        await tx
          .update(sepaMandatesTable)
          .set(patch as never)
          .where(eq(sepaMandatesTable.id, input.id));

        const changes = diff(existing as unknown as Record<string, unknown>, projected);
        if (Object.keys(changes).length > 0) {
          await appendAudit(tx, {
            entityType: "sepa_mandate",
            entityId: input.id,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes,
            requestId: context.requestId ?? null,
          });
        }
      });

      return { ok: true };
    }),

  /**
   * Soft-revoke: sets `widerrufen_am` to now and `is_deleted=true` so the
   * mandate stays in the audit history but is excluded from active mandate
   * lookups. Hard deletion is intentionally not exposed -- once a mandate is
   * used for a Lastschrift it must remain referenceable for SEPA returns.
   */
  revoke: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sepaMandatesTable)
        .where(eq(sepaMandatesTable.id, input.id))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
      }
      const now = new Date();
      await tx
        .update(sepaMandatesTable)
        .set({ widerrufenAm: now, isDeleted: true, updatedAt: now } as never)
        .where(eq(sepaMandatesTable.id, input.id));
      await appendAudit(tx, {
        entityType: "sepa_mandate",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          widerrufenAm: {
            before: existing.widerrufenAm?.toISOString() ?? null,
            after: now.toISOString(),
          },
          isDeleted: { before: existing.isDeleted ?? false, after: true },
        },
        requestId: context.requestId ?? null,
      });
    });
    return { ok: true };
  }),
};
