import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { assertCancellationAllowed } from "~/server/lib/cancellation-frist";
import { vorstandProc } from "~/server/orpc/base";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

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

function validateBetragString(value: string | null | undefined, field: string): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiger Betrag im Feld "${field}": ${value}`,
    });
  }
  return normalized;
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
    betrag: validateBetragString(input.betrag, "Betrag"),
    aufnahmegeb: validateBetragString(input.aufnahmegeb, "Aufnahmegebühr"),
    sollstellung: input.sollstellung ?? null,
    vertragBegin: toDateOrNull(input.vertragBegin, "Vertragsbeginn"),
    vertragEnde: toDateOrNull(input.vertragEnde, "Vertragsende"),
    gekuendAm: toDateOrNull(input.gekuendAm, "Gekündigt am"),
    gekuendZum: toDateOrNull(input.gekuendZum, "Gekündigt zum"),
    updatedAt: new Date(),
  };
}

export const contractsRouter = {
  create: vorstandProc
    .input(v.object({ memberId: v.string(), patch: ContractInput }))
    .handler(async ({ context, input }) => {
      return await context.db.transaction(async (tx) => {
        const [member] = await tx
          .select({
            id: membersTable.id,
            adrNr: membersTable.adrNr,
            mitgliedsnummer: membersTable.mitgliedsnummer,
          })
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }
        const patch = buildPatch(input.patch);
        if (patch.gekuendZum instanceof Date) {
          const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
          assertCancellationAllowed(settings, patch.gekuendZum);
        }
        const [row] = await tx
          .insert(contractsTable)
          .values({
            ...(patch as Record<string, unknown>),
            memberId: member.id,
            adrNr: member.adrNr,
            mitglNr: member.mitgliedsnummer ?? null,
          } as never)
          .returning({ id: contractsTable.id });
        if (!row) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
        }
        const auditId = await appendAudit(tx, {
          entityType: "contract",
          entityId: row.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(null, { ...patch, memberId: member.id }),
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, member.id, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
        return { id: row.id };
      });
    }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: ContractInput }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(contractsTable)
          .where(eq(contractsTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden." });
        }
        const patch = buildPatch(input.patch);
        if (
          patch.gekuendZum instanceof Date &&
          patch.gekuendZum.getTime() !== existing.gekuendZum?.getTime()
        ) {
          const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
          assertCancellationAllowed(settings, patch.gekuendZum);
        }
        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };
        await tx
          .update(contractsTable)
          .set(patch as never)
          .where(eq(contractsTable.id, input.id));
        const changes = diff(existing as unknown as Record<string, unknown>, projected);
        if (Object.keys(changes).length > 0) {
          const auditId = await appendAudit(tx, {
            entityType: "contract",
            entityId: input.id,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes,
            requestId: context.requestId ?? null,
          });
          await takeMemberSnapshot(tx, existing.memberId, {
            trigger: "mutation",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            auditId,
          });
        }
      });
      return { ok: true };
    }),

  remove: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(contractsTable)
        .where(eq(contractsTable.id, input.id))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Vertrag nicht gefunden." });
      }
      await tx.delete(contractsTable).where(eq(contractsTable.id, input.id));
      const auditId = await appendAudit(tx, {
        entityType: "contract",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(existing as unknown as Record<string, unknown>, {}),
        requestId: context.requestId ?? null,
      });
      await takeMemberSnapshot(tx, existing.memberId, {
        trigger: "mutation",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        auditId,
      });
    });
    return { ok: true };
  }),
};
