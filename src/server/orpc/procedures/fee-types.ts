import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { withUniqueRetry } from "~/server/db/retry";
import { contractsTable } from "~/server/db/schema/contracts";
import { feeTypePriceHistoryTable } from "~/server/db/schema/fee-type-history";
import { ANTRAGS_ROLLEN, feeTypesTable } from "~/server/db/schema/fee-types";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import { CACHE_NS, cached, invalidateFeeTypeCaches } from "~/server/search/cache";

const TextOrNull = v.optional(v.nullable(v.string()));
const DecimalOrNull = v.optional(v.nullable(v.string()));

const AgeOrNull = v.optional(
  v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(120))),
);

const FeeTypePatch = v.object({
  bezeichnung: TextOrNull,
  abteilung: TextOrNull,
  betrag1: DecimalOrNull,
  sollstellung: TextOrNull,
  kontoname: TextOrNull,
  valuta: TextOrNull,
  nichAktiv: TextOrNull,
  minAge: AgeOrNull,
  maxAge: AgeOrNull,
  antragsRolle: v.optional(v.nullable(v.picklist(ANTRAGS_ROLLEN))),
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
  if ("minAge" in input) patch.minAge = input.minAge ?? null;
  if ("maxAge" in input) patch.maxAge = input.maxAge ?? null;
  if ("antragsRolle" in input) patch.antragsRolle = input.antragsRolle ?? null;
  return patch;
}

/**
 * Guard the one-Beitragsart-per-role rule with a friendly error before the
 * partial unique index would reject the write with a raw 23505. `selfArt` is
 * excluded so re-saving the same Beitragsart with its existing role is fine.
 */
async function assertRoleFree(tx: DBOrTx, rolle: string, selfArt: number | null): Promise<void> {
  const [other] = await tx
    .select({ art: feeTypesTable.art })
    .from(feeTypesTable)
    .where(eq(feeTypesTable.antragsRolle, rolle))
    .limit(1);
  if (other && other.art !== selfArt) {
    throw new ORPCError("CONFLICT", {
      message: `Diese Rolle ist bereits Beitragsart ${other.art} zugeordnet. Bitte dort zuerst entfernen.`,
    });
  }
}

export const feeTypesRouter = {
  list: authedProc.input(v.void()).handler(async ({ context }) =>
    cached(context.tenant.key, CACHE_NS.feeTypes, "list", 300, () =>
      // Aliased subquery is intentional: Drizzle elides table qualifiers for
      // column refs inside `sql` templates when used in a top-level select(),
      // so `${contractsTable.art} = ${feeTypesTable.art}` would compile to
      // `"art" = "art"` (always true) and return the total row count for
      // every fee type. Using an alias on the inner table sidesteps that.
      context.db
        .select({
          art: feeTypesTable.art,
          bezeichnung: feeTypesTable.bezeichnung,
          abteilung: feeTypesTable.abteilung,
          betrag1: feeTypesTable.betrag1,
          sollstellung: feeTypesTable.sollstellung,
          kontoname: feeTypesTable.kontoname,
          valuta: feeTypesTable.valuta,
          nichAktiv: feeTypesTable.nichAktiv,
          minAge: feeTypesTable.minAge,
          maxAge: feeTypesTable.maxAge,
          antragsRolle: feeTypesTable.antragsRolle,
          contractCount: sql<number>`(select count(*)::int from contracts c where c.art = fee_types.art)`,
        })
        .from(feeTypesTable)
        .orderBy(asc(feeTypesTable.art)),
    ),
  ),

  create: adminProc
    .input(
      v.object({
        art: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1)))),
        patch: FeeTypePatch,
      }),
    )
    .handler(async ({ context, input }) => {
      // Auto-numbered `art` races under concurrency (two creates read the
      // same max and collide on the unique index). Retry re-reads the max.
      const result = await withUniqueRetry(() =>
        context.db.transaction(async (tx) => {
          let art = input.art ?? null;
          if (art == null) {
            const [row] = await tx
              .select({ max: sql<number>`coalesce(max(${feeTypesTable.art}), 0)::int` })
              .from(feeTypesTable);
            art = (row?.max ?? 0) + 1;
          } else {
            const [dupe] = await tx
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
          if (typeof patch.antragsRolle === "string") {
            await assertRoleFree(tx, patch.antragsRolle, null);
          }
          await tx.insert(feeTypesTable).values({ ...patch, art, updatedAt: new Date() } as never);
          await appendAudit(tx, {
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
      );
      await invalidateFeeTypeCaches(context.tenant.key);
      return result;
    }),

  update: adminProc
    .input(
      v.object({
        art: v.pipe(v.number(), v.integer()),
        patch: FeeTypePatch,
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, input.art))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
        }
        const patch = buildPatch(input.patch);
        if (Object.keys(patch).length === 0) return;
        if (typeof patch.antragsRolle === "string") {
          await assertRoleFree(tx, patch.antragsRolle, input.art);
        }

        await tx
          .update(feeTypesTable)
          .set({ ...patch, updatedAt: new Date() } as never)
          .where(eq(feeTypesTable.art, input.art));

        const changes = diff(existing as unknown as Record<string, unknown>, {
          ...(existing as unknown as Record<string, unknown>),
          ...patch,
        });
        if (Object.keys(changes).length > 0) {
          await appendAudit(tx, {
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
      });
      await invalidateFeeTypeCaches(context.tenant.key);
      return { ok: true };
    }),

  /**
   * Set ONLY the optional age range (minAge/maxAge) of a Beitragsart. Unlike
   * `update` (adminProc, edits any field), this is intentionally vorstand-level
   * and limited to the two age fields: they drive only the data-quality check
   * `tarif_passt_nicht_zum_alter` and never touch billing or money. Exposed to
   * the MCP so an assistant can arm that check (issue #244).
   */
  setAgeRange: vorstandProc
    .input(
      v.object({
        art: v.pipe(v.number(), v.integer()),
        minAge: AgeOrNull,
        maxAge: AgeOrNull,
      }),
    )
    .handler(async ({ context, input }) => {
      const minAge = input.minAge ?? null;
      const maxAge = input.maxAge ?? null;
      if (minAge != null && maxAge != null && minAge > maxAge) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Alter von darf nicht größer als Alter bis sein.",
        });
      }
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, input.art))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
        }
        await tx
          .update(feeTypesTable)
          .set({ minAge, maxAge, updatedAt: new Date() })
          .where(eq(feeTypesTable.art, input.art));
        const changes = diff(existing as unknown as Record<string, unknown>, {
          ...(existing as unknown as Record<string, unknown>),
          minAge,
          maxAge,
        });
        if (Object.keys(changes).length > 0) {
          await appendAudit(tx, {
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
      });
      await invalidateFeeTypeCaches(context.tenant.key);
      return { ok: true };
    }),

  delete: adminProc
    .input(v.object({ art: v.pipe(v.number(), v.integer()) }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, input.art))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Beitragsart nicht gefunden." });
        }

        const [usage] = await tx
          .select({ c: count() })
          .from(contractsTable)
          .where(eq(contractsTable.art, input.art));
        if ((usage?.c ?? 0) > 0) {
          throw new ORPCError("CONFLICT", {
            message: `Beitragsart wird von ${usage?.c} Vertrag/Verträgen verwendet.`,
          });
        }

        await tx.delete(feeTypesTable).where(eq(feeTypesTable.art, input.art));
        await appendAudit(tx, {
          entityType: "fee_type",
          entityId: String(input.art),
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(existing as unknown as Record<string, unknown>, {}),
          requestId: context.requestId ?? null,
        });
      });
      await invalidateFeeTypeCaches(context.tenant.key);
      return { ok: true };
    }),

  /**
   * Merge a junk/duplicate Beitragsart into a target one: every contract on the
   * source `art` is reassigned to the target, the source price history is
   * dropped, and the source fee type is deleted. This is the supported way to
   * remove a legacy duplicate (e.g. "Erwachsene doppelt") that the plain delete
   * refuses because contracts still reference it.
   */
  merge: adminProc
    .input(
      v.object({
        fromArt: v.pipe(v.number(), v.integer()),
        toArt: v.pipe(v.number(), v.integer()),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.fromArt === input.toArt) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Quelle und Ziel müssen unterschiedlich sein.",
        });
      }
      const result = await context.db.transaction(async (tx) => {
        const [from] = await tx
          .select()
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, input.fromArt))
          .limit(1);
        if (!from) {
          throw new ORPCError("NOT_FOUND", { message: "Quell-Beitragsart nicht gefunden." });
        }
        const [to] = await tx
          .select()
          .from(feeTypesTable)
          .where(eq(feeTypesTable.art, input.toArt))
          .limit(1);
        if (!to) {
          throw new ORPCError("NOT_FOUND", { message: "Ziel-Beitragsart nicht gefunden." });
        }

        // A contract is keyed by (adr_nr, vertrag_nr, art). If a member already
        // has a contract under the target art with the same vertrag_nr, moving
        // the source contract would violate that unique index. Surface the
        // conflict up front instead of failing mid-merge.
        const [collision] = await tx
          .select({ c: count() })
          .from(contractsTable)
          .where(
            and(
              eq(contractsTable.art, input.fromArt),
              sql`exists (select 1 from contracts other where other.art = ${input.toArt}
                and other.adr_nr = ${contractsTable.adrNr}
                and other.vertrag_nr = ${contractsTable.vertragNr})`,
            ),
          );
        if ((collision?.c ?? 0) > 0) {
          throw new ORPCError("CONFLICT", {
            message: `${collision?.c} Vertrag/Verträge existieren bereits unter der Ziel-Beitragsart. Bitte diese zuerst manuell bereinigen.`,
          });
        }

        const moved = await tx
          .update(contractsTable)
          .set({
            art: input.toArt,
            // Refresh the denormalized name snapshot to the target, but keep the
            // existing value if the target has no Bezeichnung.
            artName: sql`coalesce(${to.bezeichnung}, ${contractsTable.artName})`,
            updatedAt: new Date(),
          })
          .where(eq(contractsTable.art, input.fromArt))
          .returning({ id: contractsTable.id });

        await tx
          .delete(feeTypePriceHistoryTable)
          .where(eq(feeTypePriceHistoryTable.art, input.fromArt));
        await tx.delete(feeTypesTable).where(eq(feeTypesTable.art, input.fromArt));

        await appendAudit(tx, {
          entityType: "fee_type",
          entityId: String(input.fromArt),
          // No dedicated "merge" audit action exists; the source is deleted, so
          // record a delete and carry the merge target + count as synthetic keys.
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            ...diff(from as unknown as Record<string, unknown>, {}),
            __mergedInto: { before: null, after: input.toArt },
            __reassignedContracts: { before: null, after: moved.length },
          },
          requestId: context.requestId ?? null,
        });

        return { reassigned: moved.length, fromArt: input.fromArt, toArt: input.toArt };
      });
      await invalidateFeeTypeCaches(context.tenant.key);
      return result;
    }),
};
