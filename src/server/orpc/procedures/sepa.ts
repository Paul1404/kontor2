import { eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { vorstandProc } from "~/server/orpc/base";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { appendAudit } from "~/server/audit/log";

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
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
    const [member] = await context.db
      .select({ id: membersTable.id, adrNr: membersTable.adrNr })
      .from(membersTable)
      .where(eq(membersTable.id, input.memberId))
      .limit(1);
    if (!member) {
      throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
    }

    let mandatsNr = input.mandatsNr?.trim();
    if (!mandatsNr) {
      // Generate `M{seq}` where seq is the next integer suffix not yet used
      // for this member. Keeps the format short and predictable, and avoids
      // collisions with the Linear-imported numeric mandate refs.
      const [maxRow] = await context.db
        .select({
          maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
        })
        .from(sepaMandatesTable)
        .where(eq(sepaMandatesTable.memberId, member.id));
      mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
    }

    const [row] = await context.db
      .insert(sepaMandatesTable)
      .values({
        memberId: member.id,
        adrNr: member.adrNr,
        mandatsNr,
        lastschriftart: input.lastschriftart ?? null,
        typ: input.typ ?? null,
        status: input.status ?? null,
        angelegtAm: new Date(),
        unterschriftDatum: toDateOrNull(input.unterschriftDatum),
        gueltigAb: toDateOrNull(input.gueltigAb),
        gultigBis: toDateOrNull(input.gultigBis),
      } as never)
      .returning({ id: sepaMandatesTable.id });
    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
    }

    await appendAudit(context.db, {
      entityType: "sepa_mandate",
      entityId: row.id,
      action: "create",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: {
        mandatsNr: { before: null, after: mandatsNr },
        memberId: { before: null, after: member.id },
      },
      requestId: context.requestId ?? null,
    });

    return { id: row.id, mandatsNr };
  }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: UpdateInput }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
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
        patch.unterschriftDatum = toDateOrNull(input.patch.unterschriftDatum);
      if ("gueltigAb" in input.patch) patch.gueltigAb = toDateOrNull(input.patch.gueltigAb);
      if ("gultigBis" in input.patch) patch.gultigBis = toDateOrNull(input.patch.gultigBis);
      if ("widerrufenAm" in input.patch)
        patch.widerrufenAm = toDateOrNull(input.patch.widerrufenAm);

      await context.db
        .update(sepaMandatesTable)
        .set(patch as never)
        .where(eq(sepaMandatesTable.id, input.id));

      await appendAudit(context.db, {
        entityType: "sepa_mandate",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          status: { before: existing.status, after: input.patch.status ?? existing.status },
        },
        requestId: context.requestId ?? null,
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
    const [existing] = await context.db
      .select()
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.id, input.id))
      .limit(1);
    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
    }
    const now = new Date();
    await context.db
      .update(sepaMandatesTable)
      .set({ widerrufenAm: now, isDeleted: true, updatedAt: now } as never)
      .where(eq(sepaMandatesTable.id, input.id));
    await appendAudit(context.db, {
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
      },
      requestId: context.requestId ?? null,
    });
    return { ok: true };
  }),
};
