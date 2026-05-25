import { and, asc, between, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { attachmentsTable } from "~/server/db/schema/attachments";
import { auditLogTable } from "~/server/db/schema/audit";
import { contractsTable } from "~/server/db/schema/contracts";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { vorstandProc } from "~/server/orpc/base";

const ActionEnum = v.picklist(["create", "update", "delete", "restore"]);

const ListInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
  pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
  q: v.optional(v.string(), ""),
  actorEmail: v.optional(v.nullable(v.string()), null),
  action: v.optional(v.nullable(ActionEnum), null),
  entityType: v.optional(v.nullable(v.string()), null),
  entityId: v.optional(v.nullable(v.string()), null),
  /** Inclusive lower bound, ISO date (YYYY-MM-DD) */
  from: v.optional(v.nullable(v.string()), null),
  /** Inclusive upper bound, ISO date (YYYY-MM-DD) */
  to: v.optional(v.nullable(v.string()), null),
});

function toStartOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toEndOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59.999Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const auditRouter = {
  /**
   * Paginated audit feed with optional filters. Resolves the `entityId`
   * column to a human label (member name + Mitgliedsnummer) for the
   * entity types that map back to a member, so the UI can show "Mitglied
   * 1353 (Kritzner, Yoann-Feinn)" instead of a raw UUID.
   */
  list: vorstandProc.input(ListInput).handler(async ({ context, input }) => {
    const conditions: ReturnType<typeof eq>[] = [];
    if (input.action) conditions.push(eq(auditLogTable.action, input.action) as never);
    if (input.entityType) conditions.push(eq(auditLogTable.entityType, input.entityType) as never);
    if (input.entityId) conditions.push(eq(auditLogTable.entityId, input.entityId) as never);
    if (input.actorEmail) conditions.push(eq(auditLogTable.actorEmail, input.actorEmail) as never);
    const from = toStartOfDay(input.from);
    const to = toEndOfDay(input.to);
    if (from && to) conditions.push(between(auditLogTable.createdAt, from, to) as never);
    else if (from) conditions.push(gte(auditLogTable.createdAt, from) as never);
    else if (to) conditions.push(lte(auditLogTable.createdAt, to) as never);

    if (input.q.trim()) {
      const like = `%${input.q.trim()}%`;
      conditions.push(
        or(
          ilike(auditLogTable.actorEmail, like),
          ilike(auditLogTable.entityId, like),
          ilike(auditLogTable.entityType, like),
          // jsonb -> text cast for field-name/value substring search
          sql`${auditLogTable.changes}::text ilike ${like}`,
        ) as never,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const offset = (input.page - 1) * input.pageSize;
    const [rows, [totalRow]] = await Promise.all([
      context.db
        .select()
        .from(auditLogTable)
        .where(where)
        .orderBy(desc(auditLogTable.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      context.db.select({ c: sql<number>`count(*)::int` }).from(auditLogTable).where(where),
    ]);

    // Resolve each row's entity to a member so the UI can show a name +
    // link. We do this in one pass per entity type to avoid N+1.
    const memberIds = new Set<string>();
    const contractIds = new Set<string>();
    const sepaIds = new Set<string>();
    const attachmentIds = new Set<string>();
    for (const r of rows) {
      if (r.entityType === "member") memberIds.add(r.entityId);
      else if (r.entityType === "contract") contractIds.add(r.entityId);
      else if (r.entityType === "sepa_mandate") sepaIds.add(r.entityId);
      else if (r.entityType === "member_attachment") attachmentIds.add(r.entityId);
    }

    type MemberLite = {
      id: string;
      mitglnr: string | null;
      adrNr: number;
      vorname: string | null;
      nachname: string | null;
    };
    const memberById = new Map<string, MemberLite>();
    const recordToMember = new Map<string, string>();

    async function loadMembers(ids: string[]) {
      if (ids.length === 0) return;
      const rows2 = await context.db
        .select({
          id: membersTable.id,
          mitglnr: membersTable.mitglnr,
          adrNr: membersTable.adrNr,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
        })
        .from(membersTable)
        .where(inArray(membersTable.id, ids));
      for (const m of rows2) memberById.set(m.id, m);
    }

    async function loadJoin(
      ids: Set<string>,
      table: typeof contractsTable | typeof sepaMandatesTable | typeof attachmentsTable,
    ) {
      if (ids.size === 0) return [] as string[];
      const rows2 = await context.db
        .select({ id: table.id, memberId: table.memberId })
        .from(table)
        .where(inArray(table.id, Array.from(ids)));
      for (const r of rows2) recordToMember.set(r.id, r.memberId);
      return rows2.map((r) => r.memberId);
    }

    const [contractMemberIds, sepaMemberIds, attMemberIds] = await Promise.all([
      loadJoin(contractIds, contractsTable),
      loadJoin(sepaIds, sepaMandatesTable),
      loadJoin(attachmentIds, attachmentsTable),
    ]);

    await loadMembers(
      Array.from(new Set([...memberIds, ...contractMemberIds, ...sepaMemberIds, ...attMemberIds])),
    );

    const resolved = rows.map((r) => {
      let memberId: string | undefined;
      if (r.entityType === "member") memberId = r.entityId;
      else memberId = recordToMember.get(r.entityId);
      const target = memberId ? memberById.get(memberId) : undefined;
      return {
        ...r,
        target: target
          ? {
              memberId: target.id,
              mitglnr: target.mitglnr,
              adrNr: target.adrNr,
              vorname: target.vorname,
              nachname: target.nachname,
            }
          : null,
      };
    });

    return { rows: resolved, total: totalRow?.c ?? 0 };
  }),

  /** Distinct actor emails present in the log, for the actor filter dropdown. */
  actors: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db
      .selectDistinct({ email: auditLogTable.actorEmail })
      .from(auditLogTable)
      .where(sql`${auditLogTable.actorEmail} is not null`)
      .orderBy(asc(auditLogTable.actorEmail));
    return rows.map((r) => r.email).filter((e): e is string => e != null);
  }),

  /** Entity types currently present in the log, for the type filter dropdown. */
  entityTypes: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rows = await context.db
      .selectDistinct({ entityType: auditLogTable.entityType })
      .from(auditLogTable)
      .orderBy(asc(auditLogTable.entityType));
    return rows.map((r) => r.entityType);
  }),
};
