import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import { slugify } from "~/server/importer/abteilung-splitter";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";

const NameInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const DateStringInput = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

export const abteilungenRouter = {
  list: authedProc.input(v.void()).handler(async ({ context }) => {
    // Use raw qualified table names in the correlated subquery. Drizzle's
    // `sql` template elides column qualifiers inside .select(), so passing
    // `${table.column}` here yields `"id" = "id"` (always true).
    return context.db
      .select({
        id: abteilungenTable.id,
        name: abteilungenTable.name,
        slug: abteilungenTable.slug,
        sportart: abteilungenTable.sportart,
        verbandName: abteilungenTable.verbandName,
        verbandNr: abteilungenTable.verbandNr,
        inaktiv: abteilungenTable.inaktiv,
        memberCount: sql<number>`(select count(*)::int from member_abteilungen ma where ma.abteilung_id = abteilungen.id and ma.austrittsdatum is null)`,
        totalCount: sql<number>`(select count(*)::int from member_abteilungen ma where ma.abteilung_id = abteilungen.id)`,
      })
      .from(abteilungenTable)
      .orderBy(asc(abteilungenTable.name));
  }),

  create: adminProc.input(v.object({ name: NameInput })).handler(async ({ context, input }) => {
    const slug = slugify(input.name);
    if (!slug) {
      throw new ORPCError("VALIDATION_FAILED", { message: "Name ergibt keinen gültigen Slug." });
    }
    return await context.db.transaction(async (tx) => {
      const [dupe] = await tx
        .select({ id: abteilungenTable.id })
        .from(abteilungenTable)
        .where(eq(abteilungenTable.name, input.name))
        .limit(1);
      if (dupe) {
        throw new ORPCError("CONFLICT", {
          message: `Abteilung "${input.name}" existiert bereits.`,
        });
      }
      const [inserted] = await tx
        .insert(abteilungenTable)
        .values({ name: input.name, slug })
        .returning({ id: abteilungenTable.id, name: abteilungenTable.name });
      if (!inserted) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
      }
      await appendAudit(tx, {
        entityType: "abteilung",
        entityId: inserted.id,
        action: "create",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff(null, { name: input.name, slug }),
        requestId: context.requestId ?? null,
      });
      return inserted;
    });
  }),

  rename: adminProc
    .input(v.object({ id: v.string(), name: NameInput }))
    .handler(async ({ context, input }) => {
      return await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(abteilungenTable)
          .where(eq(abteilungenTable.id, input.id))
          .limit(1);
        if (!existing) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
        if (existing.name === input.name) return { ok: true };

        const slug = slugify(input.name);
        const [dupe] = await tx
          .select({ id: abteilungenTable.id })
          .from(abteilungenTable)
          .where(eq(abteilungenTable.name, input.name))
          .limit(1);
        if (dupe && dupe.id !== input.id) {
          throw new ORPCError("CONFLICT", {
            message: `Eine andere Abteilung trägt bereits den Namen "${input.name}".`,
          });
        }

        await tx
          .update(abteilungenTable)
          .set({ name: input.name, slug })
          .where(eq(abteilungenTable.id, input.id));

        await appendAudit(tx, {
          entityType: "abteilung",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff({ name: existing.name, slug: existing.slug }, { name: input.name, slug }),
          requestId: context.requestId ?? null,
        });
        return { ok: true };
      });
    }),

  update: adminProc
    .input(
      v.object({
        id: v.string(),
        sportart: v.optional(v.nullable(v.string())),
        verbandName: v.optional(v.nullable(v.string())),
        verbandNr: v.optional(v.nullable(v.string())),
        inaktiv: v.optional(v.boolean()),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(abteilungenTable)
          .where(eq(abteilungenTable.id, input.id))
          .limit(1);
        if (!existing) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
        const patch: Record<string, unknown> = {};
        if ("sportart" in input) patch.sportart = input.sportart ?? null;
        if ("verbandName" in input) patch.verbandName = input.verbandName ?? null;
        if ("verbandNr" in input) patch.verbandNr = input.verbandNr ?? null;
        if ("inaktiv" in input) patch.inaktiv = input.inaktiv ?? false;
        if (Object.keys(patch).length === 0) return;

        await tx
          .update(abteilungenTable)
          .set(patch as never)
          .where(eq(abteilungenTable.id, input.id));

        await appendAudit(tx, {
          entityType: "abteilung",
          entityId: input.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(existing as unknown as Record<string, unknown>, {
            ...(existing as unknown as Record<string, unknown>),
            ...patch,
          }),
          requestId: context.requestId ?? null,
        });
      });
      return { ok: true };
    }),

  delete: adminProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(abteilungenTable)
        .where(eq(abteilungenTable.id, input.id))
        .limit(1);
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });

      const [usage] = await tx
        .select({ c: count() })
        .from(memberAbteilungenTable)
        .where(eq(memberAbteilungenTable.abteilungId, input.id));
      if ((usage?.c ?? 0) > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Abteilung hat noch ${usage?.c} Mitgliedschaft(en). Erst alle Zuordnungen entfernen.`,
        });
      }

      await tx.delete(abteilungenTable).where(eq(abteilungenTable.id, input.id));

      await appendAudit(tx, {
        entityType: "abteilung",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: diff({ name: existing.name, slug: existing.slug }, {}),
        requestId: context.requestId ?? null,
      });
    });
    return { ok: true };
  }),

  assignMember: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        abteilungId: v.string(),
        eintrittsdatum: DateStringInput,
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [member] = await tx
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

        const [abteilung] = await tx
          .select({ id: abteilungenTable.id, name: abteilungenTable.name })
          .from(abteilungenTable)
          .where(eq(abteilungenTable.id, input.abteilungId))
          .limit(1);
        if (!abteilung) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });

        try {
          await tx.insert(memberAbteilungenTable).values({
            memberId: input.memberId,
            abteilungId: input.abteilungId,
            eintrittsdatum: input.eintrittsdatum,
          });
        } catch (e) {
          throw new ORPCError("CONFLICT", {
            message: "Diese Abteilungs-Mitgliedschaft existiert bereits.",
            cause: e,
          });
        }

        await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            [`abteilung:${abteilung.name}`]: {
              before: null,
              after: { eintrittsdatum: input.eintrittsdatum },
            },
          },
          requestId: context.requestId ?? null,
        });
      });
      await invalidateMemberCaches();
      return { ok: true };
    }),

  setMemberAustritt: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        abteilungId: v.string(),
        eintrittsdatum: DateStringInput,
        austrittsdatum: v.nullable(DateStringInput),
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ austrittsdatum: memberAbteilungenTable.austrittsdatum })
          .from(memberAbteilungenTable)
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              eq(memberAbteilungenTable.abteilungId, input.abteilungId),
              eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
            ),
          )
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mitgliedschaft nicht gefunden." });
        }
        await tx
          .update(memberAbteilungenTable)
          .set({ austrittsdatum: input.austrittsdatum })
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              eq(memberAbteilungenTable.abteilungId, input.abteilungId),
              eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
            ),
          );
        await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            austrittsdatum: { before: existing.austrittsdatum, after: input.austrittsdatum },
          },
          requestId: context.requestId ?? null,
        });
      });
      await invalidateMemberCaches();
      return { ok: true };
    }),

  removeMember: vorstandProc
    .input(
      v.object({
        memberId: v.string(),
        abteilungId: v.string(),
        eintrittsdatum: DateStringInput,
      }),
    )
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        await tx
          .delete(memberAbteilungenTable)
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              eq(memberAbteilungenTable.abteilungId, input.abteilungId),
              eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
            ),
          );
        await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            [`abteilungId:${input.abteilungId}`]: {
              before: { eintrittsdatum: input.eintrittsdatum },
              after: null,
            },
          },
          requestId: context.requestId ?? null,
        });
      });
      await invalidateMemberCaches();
      return { ok: true };
    }),
};
