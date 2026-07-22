import { ORPCError } from "@orpc/server";
import { and, asc, count, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { KEINE_ABTEILUNG_NAME } from "~/lib/abteilung-filter";
import { appendAudit, diff } from "~/server/audit/log";
import { memberNotDeleted } from "~/server/db/member-filters";
import { isUniqueViolation } from "~/server/db/retry";
import { abteilungenTable, memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { slugify } from "~/server/importer/abteilung-splitter";
import { assertCancellationAllowed } from "~/server/lib/cancellation-frist";
import { adminProc, authedProc, vorstandProc } from "~/server/orpc/base";
import {
  CACHE_NS,
  cached,
  invalidateAbteilungCaches,
  invalidateFeeTypeCaches,
  invalidateMemberCaches,
} from "~/server/search/cache";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const NameInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const DateStringInput = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));

export const abteilungenRouter = {
  list: authedProc.input(v.void()).handler(async ({ context }) =>
    cached(context.tenant.key, CACHE_NS.abteilungen, "full", 300, () =>
      // Use raw qualified table names in the correlated subquery. Drizzle's
      // `sql` template elides column qualifiers inside .select(), so passing
      // `${table.column}` here yields `"id" = "id"` (always true).
      context.db
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
        .orderBy(asc(abteilungenTable.name)),
    ),
  ),

  create: adminProc.input(v.object({ name: NameInput })).handler(async ({ context, input }) => {
    const slug = slugify(input.name);
    if (!slug) {
      throw new ORPCError("VALIDATION_FAILED", { message: "Name ergibt keinen gültigen Slug." });
    }
    const result = await context.db.transaction(async (tx) => {
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
    await invalidateAbteilungCaches(context.tenant.key);
    return result;
  }),

  rename: adminProc
    .input(v.object({ id: v.string(), name: NameInput }))
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
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
      await invalidateAbteilungCaches(context.tenant.key);
      return result;
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
      await invalidateAbteilungCaches(context.tenant.key);
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
    await invalidateAbteilungCaches(context.tenant.key);
    return { ok: true };
  }),

  /**
   * Merge a duplicate Abteilung into a target one: all memberships move from
   * the source to the target, fee types relabel to the target name, and the
   * source Abteilung is deleted. The membership PK is
   * (member, abteilung, eintrittsdatum), so a member who already sits in the
   * target for the same Eintrittsdatum keeps the target row; if the source row
   * was still active, the surviving target row is reactivated.
   */
  merge: adminProc
    .input(v.object({ fromId: v.string(), toId: v.string() }))
    .handler(async ({ context, input }) => {
      if (input.fromId === input.toId) {
        throw new ORPCError("VALIDATION_FAILED", {
          message: "Quelle und Ziel müssen unterschiedlich sein.",
        });
      }
      const result = await context.db.transaction(async (tx) => {
        const [from] = await tx
          .select()
          .from(abteilungenTable)
          .where(eq(abteilungenTable.id, input.fromId))
          .limit(1);
        if (!from) throw new ORPCError("NOT_FOUND", { message: "Quell-Abteilung nicht gefunden." });
        const [to] = await tx
          .select()
          .from(abteilungenTable)
          .where(eq(abteilungenTable.id, input.toId))
          .limit(1);
        if (!to) throw new ORPCError("NOT_FOUND", { message: "Ziel-Abteilung nicht gefunden." });

        const [before] = await tx
          .select({ c: count() })
          .from(memberAbteilungenTable)
          .where(eq(memberAbteilungenTable.abteilungId, input.fromId));
        const totalLinks = before?.c ?? 0;

        // Move links that don't collide with an existing target membership for
        // the same Eintrittsdatum.
        await tx.execute(sql`
          update member_abteilungen ma set abteilung_id = ${input.toId}
          where ma.abteilung_id = ${input.fromId}
            and not exists (
              select 1 from member_abteilungen x
              where x.member_id = ma.member_id
                and x.abteilung_id = ${input.toId}
                and x.eintrittsdatum = ma.eintrittsdatum
            )`);

        // For colliding links, prefer an active membership: if the source row
        // was still active, reactivate the surviving target row.
        await tx.execute(sql`
          update member_abteilungen t set austrittsdatum = null
          where t.abteilung_id = ${input.toId}
            and t.austrittsdatum is not null
            and exists (
              select 1 from member_abteilungen s
              where s.member_id = t.member_id
                and s.abteilung_id = ${input.fromId}
                and s.eintrittsdatum = t.eintrittsdatum
                and s.austrittsdatum is null
            )`);

        // Drop the leftover colliding source links, then the Abteilung itself.
        await tx
          .delete(memberAbteilungenTable)
          .where(eq(memberAbteilungenTable.abteilungId, input.fromId));

        // Fee types carry the Abteilung as a text label; keep them consistent.
        await tx
          .update(feeTypesTable)
          .set({ abteilung: to.name, updatedAt: new Date() })
          .where(eq(feeTypesTable.abteilung, from.name));

        await tx.delete(abteilungenTable).where(eq(abteilungenTable.id, input.fromId));

        await appendAudit(tx, {
          entityType: "abteilung",
          entityId: input.fromId,
          action: "delete",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            ...diff({ name: from.name, slug: from.slug }, {}),
            __mergedInto: { before: null, after: to.name },
            __reassignedLinks: { before: null, after: totalLinks },
          },
          requestId: context.requestId ?? null,
        });

        return { reassigned: totalLinks, fromName: from.name, toName: to.name };
      });
      await invalidateAbteilungCaches(context.tenant.key);
      await invalidateMemberCaches(context.tenant.key);
      await invalidateFeeTypeCaches(context.tenant.key);
      return result;
    }),

  /**
   * Backfill the real "Keine Abteilung" department for members that already
   * exist without any active department membership. The importer now maps the
   * Linear sentinel on new imports, but data imported before that change has no
   * such link; this assigns it on demand so those members show up under the
   * department instead of only via the "Ohne Abteilung" filter. Idempotent.
   */
  backfillKeineAbteilung: adminProc.input(v.void()).handler(async ({ context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await context.db.transaction(async (tx) => {
      // Ensure the canonical department exists, then resolve its id.
      await tx
        .insert(abteilungenTable)
        .values({ name: KEINE_ABTEILUNG_NAME, slug: slugify(KEINE_ABTEILUNG_NAME) })
        .onConflictDoNothing({ target: abteilungenTable.name });
      const [abt] = await tx
        .select({ id: abteilungenTable.id })
        .from(abteilungenTable)
        .where(eq(abteilungenTable.name, KEINE_ABTEILUNG_NAME))
        .limit(1);
      if (!abt) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Abteilung konnte nicht angelegt werden.",
        });
      }

      // Link every active, non-deleted member that has no active department
      // membership. Eintrittsdatum mirrors the member's Vereinseintritt, else
      // today. on conflict keeps it idempotent.
      const inserted = await tx.execute(sql`
        insert into member_abteilungen (member_id, abteilung_id, eintrittsdatum)
        select m.id, ${abt.id}, coalesce(m.eintritt::date, ${today}::date)
        from members m
        where m.deleted_at is null and m.austritt is null and m.verstorben_am is null
          and not exists (
            select 1 from member_abteilungen ma
            where ma.member_id = m.id and ma.austrittsdatum is null
          )
        on conflict do nothing
        returning member_id`);
      const assigned = (inserted as unknown as Array<unknown>).length;

      if (assigned > 0) {
        await appendAudit(tx, {
          entityType: "abteilung",
          entityId: abt.id,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: { __backfilledMembers: { before: null, after: assigned } },
          requestId: context.requestId ?? null,
        });
      }
      return { assigned };
    });
    await invalidateAbteilungCaches(context.tenant.key);
    await invalidateMemberCaches(context.tenant.key);
    return result;
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
          .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
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
          // Only a unique-violation means the membership already exists. Any
          // other DB error (connection drop, FK, type) must surface as itself,
          // not be mislabelled "existiert bereits".
          if (isUniqueViolation(e)) {
            throw new ORPCError("CONFLICT", {
              message: "Diese Abteilungs-Mitgliedschaft existiert bereits.",
              cause: e,
            });
          }
          throw e;
        }

        const auditId = await appendAudit(tx, {
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
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });
      await invalidateMemberCaches(context.tenant.key);
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
        const [member] = await tx
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
          .limit(1);
        if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
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

        // Enforce the configurable Kündigungsfrist when an Austritt date is set
        // or changed. No-op when the feature is disabled.
        if (input.austrittsdatum && input.austrittsdatum !== existing.austrittsdatum) {
          const [settings] = await tx.select().from(organizationSettingsTable).limit(1);
          assertCancellationAllowed(settings, new Date(`${input.austrittsdatum}T00:00:00Z`));
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
        const auditId = await appendAudit(tx, {
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
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });
      await invalidateMemberCaches(context.tenant.key);
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
        const [member] = await tx
          .select({ id: membersTable.id })
          .from(membersTable)
          .where(and(eq(membersTable.id, input.memberId), memberNotDeleted()))
          .limit(1);
        if (!member) throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        const removed = await tx
          .delete(memberAbteilungenTable)
          .where(
            and(
              eq(memberAbteilungenTable.memberId, input.memberId),
              eq(memberAbteilungenTable.abteilungId, input.abteilungId),
              eq(memberAbteilungenTable.eintrittsdatum, input.eintrittsdatum),
            ),
          )
          .returning({ memberId: memberAbteilungenTable.memberId });
        if (removed.length === 0) {
          throw new ORPCError("NOT_FOUND", { message: "Mitgliedschaft nicht gefunden." });
        }
        const auditId = await appendAudit(tx, {
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
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });
      });
      await invalidateMemberCaches(context.tenant.key);
      return { ok: true };
    }),
};
