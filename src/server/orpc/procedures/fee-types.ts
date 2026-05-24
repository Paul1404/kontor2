import { asc, count, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { adminProc, authedProc } from "~/server/orpc/base";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { appendAudit, diff } from "~/server/audit/log";

const TextOrNull = v.optional(v.nullable(v.string()));
const DecimalOrNull = v.optional(v.nullable(v.string()));

const FeeTypePatch = v.object({
  bezeichnung: TextOrNull,
  abteilung: TextOrNull,
  betrag1: DecimalOrNull,
  sollstellung: TextOrNull,
  kontoname: TextOrNull,
  valuta: TextOrNull,
  nichAktiv: TextOrNull,
});

function normalizeDecimal(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Ungültiger Betrag: "${value}".`,
    });
  }
  return normalized;
}

function buildPatch(input: v.InferOutput<typeof FeeTypePatch>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ("bezeichnung" in input) patch.bezeichnung = input.bezeichnung ?? null;
  if ("abteilung" in input) patch.abteilung = input.abteilung ?? null;
  if ("sollstellung" in input) patch.sollstellung = input.sollstellung ?? null;
  if ("kontoname" in input) patch.kontoname = input.kontoname ?? null;
  if ("valuta" in input) patch.valuta = input.valuta ?? null;
  if ("nichAktiv" in input) patch.nichAktiv = input.nichAktiv ?? null;
  if ("betrag1" in input) patch.betrag1 = normalizeDecimal(input.betrag1);
  return patch;
}

export const feeTypesRouter = {
  list: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        art: feeTypesTable.art,
        bezeichnung: feeTypesTable.bezeichnung,
        abteilung: feeTypesTable.abteilung,
        betrag1: feeTypesTable.betrag1,
        sollstellung: feeTypesTable.sollstellung,
        kontoname: feeTypesTable.kontoname,
        valuta: feeTypesTable.valuta,
        nichAktiv: feeTypesTable.nichAktiv,
        contractCount: sql<number>`(select count(*) from ${contractsTable} where ${contractsTable.art} = ${feeTypesTable.art})::int`,
      })
      .from(feeTypesTable)
      .orderBy(asc(feeTypesTable.art));
  }),

  create: adminProc
    .input(
      v.object({
        art: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
        patch: FeeTypePatch,
      }),
    )
    .handler(async ({ context, input }) => {
      let art = input.art ?? null;
      if (art == null) {
        const [row] = await context.db
          .select({ max: sql<number>`coalesce(max(${feeTypesTable.art}), 0)::int` })
          .from(feeTypesTable);
        art = (row?.max ?? 0) + 1;
      } else {
        const [dupe] = await context.db
          .select({ art: feeTypesTable.art })
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, art))
          .limit(1);
        if (dupe) {
          throw new ORPCError("CONFLICT", {
            message: `Beitragsart mit Nummer ${art} existiert bereits.`,
          });
        }
      }
      const patch = buildPatch(input.patch);
      await context.db
        .insert(feeTypesTable)
        .values({ ...patch, art, updatedAt: new Date() } as never);
      await appendAudit(context.db, {
        entityType: "fee_type",
        entityId: String(art),
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(null, { ...patch, art }),
        requestId: context.requestId ?? null,
      });
      return { art };
    }),

  update: adminProc
    .input(
      v.object({
        art: v.pipe(v.number(), v.integer()),
        patch: FeeTypePatch,
      }),
    )
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(feeTypesTable)
        .where(eq(feeTypesTable.art, input.art))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
      }
      const patch = buildPatch(input.patch);
      if (Object.keys(patch).length === 0) return { ok: true };

      await context.db
        .update(feeTypesTable)
        .set({ ...patch, updatedAt: new Date() } as never)
        .where(eq(feeTypesTable.art, input.art));

      const changes = diff(existing as unknown as Record<string, unknown>, {
        ...(existing as unknown as Record<string, unknown>),
        ...patch,
      });
      if (Object.keys(changes).length > 0) {
        await appendAudit(context.db, {
          entityType: "fee_type",
          entityId: String(input.art),
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes,
          requestId: context.requestId ?? null,
        });
      }
      return { ok: true };
    }),

  delete: adminProc
    .input(v.object({ art: v.pipe(v.number(), v.integer()) }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(feeTypesTable)
        .where(eq(feeTypesTable.art, input.art))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
      }

      const [usage] = await context.db
        .select({ c: count() })
        .from(contractsTable)
        .where(eq(contractsTable.art, input.art));
      if ((usage?.c ?? 0) > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Beitragsart wird von ${usage?.c} Vertrag/Verträgen verwendet.`,
        });
      }

      await context.db.delete(feeTypesTable).where(eq(feeTypesTable.art, input.art));
      await appendAudit(context.db, {
        entityType: "fee_type",
        entityId: String(input.art),
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(existing as unknown as Record<string, unknown>, {}),
        requestId: context.requestId ?? null,
      });
      return { ok: true };
    }),
};
