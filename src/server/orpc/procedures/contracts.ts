import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { vorstandProc } from "~/server/orpc/base";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { appendAudit } from "~/server/audit/log";

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

const ContractInput = v.object({
  vertragNr: v.pipe(v.string(), v.minLength(1)),
  art: v.pipe(v.number(), v.integer()),
  artName: v.optional(v.nullable(v.string())),
  betrag: v.optional(v.nullable(v.string())),
  aufnahmegeb: v.optional(v.nullable(v.string())),
  sollstellung: v.optional(v.nullable(v.string())),
  vertragBegin: v.optional(v.nullable(v.string())),
  vertragEnde: v.optional(v.nullable(v.string())),
  gekuendAm: v.optional(v.nullable(v.string())),
  gekuendZum: v.optional(v.nullable(v.string())),
});

function buildPatch(input: v.InferOutput<typeof ContractInput>): Record<string, unknown> {
  return {
    vertragNr: input.vertragNr,
    art: input.art,
    artName: input.artName ?? null,
    betrag: input.betrag ?? null,
    aufnahmegeb: input.aufnahmegeb ?? null,
    sollstellung: input.sollstellung ?? null,
    vertragBegin: toDateOrNull(input.vertragBegin),
    vertragEnde: toDateOrNull(input.vertragEnde),
    gekuendAm: toDateOrNull(input.gekuendAm),
    gekuendZum: toDateOrNull(input.gekuendZum),
    updatedAt: new Date(),
  };
}

export const contractsRouter = {
  create: vorstandProc
    .input(v.object({ memberId: v.string(), patch: ContractInput }))
    .handler(async ({ context, input }) => {
      const [member] = await context.db
        .select({ id: membersTable.id, adrNr: membersTable.adrNr, mitglnr: membersTable.mitglnr })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }
      const patch = buildPatch(input.patch);
      const [row] = await context.db
        .insert(contractsTable)
        .values({
          ...(patch as Record<string, unknown>),
          memberId: member.id,
          adrNr: member.adrNr,
          mitglNr: member.mitglnr ?? null,
        } as never)
        .returning({ id: contractsTable.id });
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      }
      await appendAudit(context.db, {
        entityType: "contract",
        entityId: row.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          memberId: { before: null, after: member.id },
          vertragNr: { before: null, after: input.patch.vertragNr },
          art: { before: null, after: input.patch.art },
        },
        requestId: context.requestId ?? null,
      });
      return { id: row.id };
    }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: ContractInput }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(contractsTable)
        .where(eq(contractsTable.id, input.id))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden." });
      }
      const patch = buildPatch(input.patch);
      await context.db
        .update(contractsTable)
        .set(patch as never)
        .where(eq(contractsTable.id, input.id));
      await appendAudit(context.db, {
        entityType: "contract",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          betrag: { before: existing.betrag, after: input.patch.betrag ?? null },
        },
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [existing] = await context.db
      .select()
      .from(contractsTable)
      .where(eq(contractsTable.id, input.id))
      .limit(1);
    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden." });
    }
    await context.db.delete(contractsTable).where(eq(contractsTable.id, input.id));
    await appendAudit(context.db, {
      entityType: "contract",
      entityId: input.id,
      action: "delete",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: {
        vertragNr: { before: existing.vertragNr, after: null },
      },
      requestId: context.requestId ?? null,
    });
    return { ok: true };
  }),
};
