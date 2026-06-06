import { ORPCError } from "@orpc/server";
import { and, eq, ne, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { vorstandProc } from "~/server/orpc/base";

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

const RelationshipPatch = v.object({
  beziehung: v.optional(v.nullable(v.string())),
  notiz: v.optional(v.nullable(v.string())),
  datVon: v.optional(v.nullable(v.string())),
  datBis: v.optional(v.nullable(v.string())),
  istVertreter: v.optional(v.boolean()),
});

export const relationshipsRouter = {
  create: vorstandProc
    .input(
      v.object({
        fromMemberId: v.string(),
        toMemberId: v.string(),
        beziehung: v.optional(v.nullable(v.string())),
        notiz: v.optional(v.nullable(v.string())),
        datVon: v.optional(v.nullable(v.string())),
        datBis: v.optional(v.nullable(v.string())),
        reciprocal: v.optional(v.boolean(), false),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.fromMemberId === input.toMemberId) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Eine Beziehung zu sich selbst ist nicht möglich.",
        });
      }

      const members = await context.db
        .select({ id: membersTable.id, adrNr: membersTable.adrNr })
        .from(membersTable)
        .where(or(eq(membersTable.id, input.fromMemberId), eq(membersTable.id, input.toMemberId)));
      const from = members.find((m) => m.id === input.fromMemberId);
      const to = members.find((m) => m.id === input.toMemberId);
      if (!from || !to) {
        throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
      }

      const base = {
        beziehung: input.beziehung ?? null,
        notiz: input.notiz ?? null,
        datVon: toDateOrNull(input.datVon, "Datum von"),
        datBis: toDateOrNull(input.datBis, "Datum bis"),
        updatedAt: new Date(),
      };

      const inserts: Array<{ from: typeof from; to: typeof to }> = [
        { from, to },
        ...(input.reciprocal ? [{ from: to, to: from }] : []),
      ];

      return await context.db.transaction(async (tx) => {
        const created: string[] = [];
        for (const pair of inserts) {
          const [row] = await tx
            .insert(relationshipsTable)
            .values({
              ...base,
              fromMemberId: pair.from.id,
              toMemberId: pair.to.id,
              fromAdrNr: pair.from.adrNr,
              toAdrNr: pair.to.adrNr,
            } as never)
            .onConflictDoUpdate({
              target: [relationshipsTable.fromAdrNr, relationshipsTable.toAdrNr],
              set: base as never,
            })
            .returning({ id: relationshipsTable.id });
          if (row) {
            created.push(row.id);
            await appendAudit(tx, {
              entityType: "relationship",
              entityId: row.id,
              action: "create",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: {
                fromMemberId: { before: null, after: pair.from.id },
                toMemberId: { before: null, after: pair.to.id },
                beziehung: { before: null, after: input.beziehung ?? null },
              },
              requestId: context.requestId ?? null,
            });
          }
        }
        return { ids: created };
      });
    }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: RelationshipPatch }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(relationshipsTable)
          .where(eq(relationshipsTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Beziehung nicht gefunden." });
        }

        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ("beziehung" in input.patch) patch.beziehung = input.patch.beziehung ?? null;
        if ("notiz" in input.patch) patch.notiz = input.patch.notiz ?? null;
        if ("datVon" in input.patch) patch.datVon = toDateOrNull(input.patch.datVon, "Datum von");
        if ("datBis" in input.patch) patch.datBis = toDateOrNull(input.patch.datBis, "Datum bis");
        if ("istVertreter" in input.patch) patch.istVertreter = input.patch.istVertreter ?? false;

        // Only one connection per member can be the Vertreter (the dunning
        // recipient for a minor). Clear the flag on the member's other
        // connections before setting it here.
        if (input.patch.istVertreter === true) {
          await tx
            .update(relationshipsTable)
            .set({ istVertreter: false, updatedAt: new Date() } as never)
            .where(
              and(
                eq(relationshipsTable.fromMemberId, existing.fromMemberId),
                ne(relationshipsTable.id, input.id),
              ),
            );
        }

        await tx
          .update(relationshipsTable)
          .set(patch as never)
          .where(eq(relationshipsTable.id, input.id));

        await appendAudit(tx, {
          entityType: "relationship",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            beziehung: {
              before: existing.beziehung,
              after:
                "beziehung" in input.patch ? (input.patch.beziehung ?? null) : existing.beziehung,
            },
            ...(input.patch.istVertreter !== undefined &&
            input.patch.istVertreter !== existing.istVertreter
              ? {
                  istVertreter: {
                    before: String(existing.istVertreter),
                    after: String(input.patch.istVertreter),
                  },
                }
              : {}),
          },
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  remove: vorstandProc
    .input(v.object({ id: v.string(), removeReciprocal: v.optional(v.boolean(), true) }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(relationshipsTable)
          .where(eq(relationshipsTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Beziehung nicht gefunden." });
        }

        await tx.delete(relationshipsTable).where(eq(relationshipsTable.id, input.id));
        await appendAudit(tx, {
          entityType: "relationship",
          entityId: input.id,
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            fromAdrNr: { before: existing.fromAdrNr, after: null },
            toAdrNr: { before: existing.toAdrNr, after: null },
          },
          requestId: context.requestId ?? null,
        });

        if (input.removeReciprocal) {
          const [mirror] = await tx
            .select()
            .from(relationshipsTable)
            .where(
              and(
                eq(relationshipsTable.fromAdrNr, existing.toAdrNr),
                eq(relationshipsTable.toAdrNr, existing.fromAdrNr),
              ),
            )
            .limit(1);
          if (mirror) {
            await tx.delete(relationshipsTable).where(eq(relationshipsTable.id, mirror.id));
            await appendAudit(tx, {
              entityType: "relationship",
              entityId: mirror.id,
              action: "delete",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: {
                fromAdrNr: { before: mirror.fromAdrNr, after: null },
                toAdrNr: { before: mirror.toAdrNr, after: null },
              },
              requestId: context.requestId ?? null,
            });
          }
        }
      });
      return { ok: true };
    }),

  /**
   * Search for a member to link to. Returns id, mitgliedsnummer, name; used by the
   * "Beziehung hinzufügen" combobox so vorstand users can find the target
   * without leaving the member detail page.
   */
  searchTargets: vorstandProc
    .input(v.object({ q: v.string(), excludeMemberId: v.optional(v.string()) }))
    .handler(async ({ context, input }) => {
      const q = input.q.trim();
      if (q.length < 2) return [];
      const like = `%${q}%`;
      const rows = await context.db
        .select({
          id: membersTable.id,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          plz: membersTable.plz,
          ort: membersTable.ort,
        })
        .from(membersTable)
        .where(
          sql`(${membersTable.nachname} ilike ${like} or ${membersTable.vorname} ilike ${like} or ${membersTable.mitgliedsnummer} ilike ${like}) and ${membersTable.deletedAt} is null`,
        )
        .limit(20);
      return input.excludeMemberId ? rows.filter((r) => r.id !== input.excludeMemberId) : rows;
    }),
};
