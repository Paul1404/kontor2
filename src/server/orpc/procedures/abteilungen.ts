import { and, asc, count, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as v from "valibot";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { membersTable } from "~/server/db/schema/members";
import { slugify } from "~/server/importer/abteilung-splitter";
import { appendAudit, diff } from "~/server/audit/log";
import { invalidateMemberCaches } from "~/server/search/cache";

const NameInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const DateStringInput = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

export const abteilungenRouter = {
  list: authedProc.input(v.void()).handler(async ({ context }) => {
    return context.db
      .select({
        id: abteilungenTable.id,
        name: abteilungenTable.name,
        slug: abteilungenTable.slug,
        memberCount: sql<number>`(select count(*) from ${memberAbteilungenTable} where ${memberAbteilungenTable.abteilungId} = ${abteilungenTable.id} and ${memberAbteilungenTable.austrittsdatum} is null)::int`,
        totalCount: sql<number>`(select count(*) from ${memberAbteilungenTable} where ${memberAbteilungenTable.abteilungId} = ${abteilungenTable.id})::int`,
      })
      .from(abteilungenTable)
      .orderBy(asc(abteilungenTable.name));
  }),

  create: adminProc.input(v.object({ name: NameInput })).handler(async ({ context, input }) => {
    const slug = slugify(input.name);
    if (!slug) {
      throw new ORPCError("VALIDATION_FAILED", { message: "Name ergibt keinen gültigen Slug." });
    }
    const [dupe] = await context.db
      .select({ id: abteilungenTable.id })
      .from(abteilungenTable)
      .where(eq(abteilungenTable.name, input.name))
      .limit(1);
    if (dupe) {
      throw new ORPCError("CONFLICT", { message: `Abteilung "${input.name}" existiert bereits.` });
    }
    const [inserted] = await context.db
      .insert(abteilungenTable)
      .values({ name: input.name, slug })
      .returning({ id: abteilungenTable.id, name: abteilungenTable.name });
    if (!inserted) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
    }
    await appendAudit(context.db, {
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
  }),

  rename: adminProc
    .input(v.object({ id: v.string(), name: NameInput }))
    .handler(async ({ context, input }) => {
      const [existing] = await context.db
        .select()
        .from(abteilungenTable)
        .where(eq(abteilungenTable.id, input.id))
        .limit(1);
      if (!existing) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });
      if (existing.name === input.name) return { ok: true };

      const slug = slugify(input.name);
      const [dupe] = await context.db
        .select({ id: abteilungenTable.id })
        .from(abteilungenTable)
        .where(eq(abteilungenTable.name, input.name))
        .limit(1);
      if (dupe && dupe.id !== input.id) {
        throw new ORPCError("CONFLICT", {
          message: `Eine andere Abteilung trägt bereits den Namen "${input.name}".`,
        });
      }

      await context.db
        .update(abteilungenTable)
        .set({ name: input.name, slug })
        .where(eq(abteilungenTable.id, input.id));

      await appendAudit(context.db, {
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
    }),

  delete: adminProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [existing] = await context.db
      .select()
      .from(abteilungenTable)
      .where(eq(abteilungenTable.id, input.id))
      .limit(1);
    if (!existing) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });

    const [usage] = await context.db
      .select({ c: count() })
      .from(memberAbteilungenTable)
      .where(eq(memberAbteilungenTable.abteilungId, input.id));
    if ((usage?.c ?? 0) > 0) {
      throw new ORPCError("CONFLICT", {
        message: `Abteilung hat noch ${usage?.c} Mitgliedschaft(en). Erst alle Zuordnungen entfernen.`,
      });
    }

    await context.db.delete(abteilungenTable).where(eq(abteilungenTable.id, input.id));

    await appendAudit(context.db, {
      entityType: "abteilung",
      entityId: input.id,
      action: "delete",
      source: "ui",
      actorId: context.session!.user.id,
      actorEmail: context.session!.user.email,
      changes: diff({ name: existing.name, slug: existing.slug }, {}),
      requestId: context.requestId ?? null,
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
      const [member] = await context.db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(eq(membersTable.id, input.memberId))
        .limit(1);
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });

      const [abteilung] = await context.db
        .select({ id: abteilungenTable.id, name: abteilungenTable.name })
        .from(abteilungenTable)
        .where(eq(abteilungenTable.id, input.abteilungId))
        .limit(1);
      if (!abteilung) throw new ORPCError("NOT_FOUND", { message: "Abteilung nicht gefunden." });

      try {
        await context.db.insert(memberAbteilungenTable).values({
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

      await appendAudit(context.db, {
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
      const [existing] = await context.db
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
      await context.db
        .update(memberAbteilungenTable)
        .set({ austrittsdatum: input.austrittsdatum })
        .where(
          and(
            eq(memberAbteilungenTable.memberId, input.memberId),
            eq(memberAbteilungenTable.abteilungId, input.abteilungId),
            eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
          ),
        );
      await appendAudit(context.db, {
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
      const result = await context.db
        .delete(memberAbteilungenTable)
        .where(
          and(
            eq(memberAbteilungenTable.memberId, input.memberId),
            eq(memberAbteilungenTable.abteilungId, input.abteilungId),
            eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
          ),
        );
      await appendAudit(context.db, {
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
      await invalidateMemberCaches();
      void result;
      return { ok: true };
    }),
};
