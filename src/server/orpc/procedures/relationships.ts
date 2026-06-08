import { ORPCError } from "@orpc/server";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { escapeLike } from "~/server/db/like";
import { membersTable } from "~/server/db/schema/members";
import { relationshipsTable } from "~/server/db/schema/relationships";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { vorstandProc } from "~/server/orpc/base";

/** Cap the graph so a pathological dataset cannot return everything at once. */
const GRAPH_EDGE_LIMIT = 4000;

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
   * The whole relationship network as nodes + undirected edges, for the canvas
   * view. Only relationships where both ends resolve to a live (non-deleted)
   * member are included; A->B and B->A collapse into one edge, flagged as a
   * representative link if either direction carries `ist_vertreter`. Capped so
   * a runaway dataset cannot blow up the payload.
   */
  graph: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const rels = (await context.db.execute(sql`
      select r.from_member_id as from_id, r.to_member_id as to_id,
             r.beziehung as beziehung, r.ist_vertreter as ist_vertreter
      from relationships r
      join members mf on mf.id = r.from_member_id and mf.deleted_at is null
      join members mt on mt.id = r.to_member_id and mt.deleted_at is null
      where r.to_member_id is not null
      limit ${GRAPH_EDGE_LIMIT + 1}
    `)) as unknown as Array<{
      from_id: string;
      to_id: string;
      beziehung: string | null;
      ist_vertreter: boolean;
    }>;

    const capped = rels.length > GRAPH_EDGE_LIMIT;
    const edgeRows = capped ? rels.slice(0, GRAPH_EDGE_LIMIT) : rels;

    // Collapse the two directions into one undirected edge.
    const edgeMap = new Map<
      string,
      { source: string; target: string; label: string | null; istVertreter: boolean }
    >();
    const nodeIds = new Set<string>();
    for (const r of edgeRows) {
      nodeIds.add(r.from_id);
      nodeIds.add(r.to_id);
      const [a, b] = r.from_id < r.to_id ? [r.from_id, r.to_id] : [r.to_id, r.from_id];
      const key = `${a}|${b}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.label = existing.label ?? r.beziehung;
        existing.istVertreter = existing.istVertreter || r.ist_vertreter;
      } else {
        edgeMap.set(key, {
          source: a,
          target: b,
          label: r.beziehung,
          istVertreter: r.ist_vertreter,
        });
      }
    }

    if (nodeIds.size === 0) {
      return { nodes: [], edges: [], capped: false };
    }

    const memberRows = await context.db
      .select({
        id: membersTable.id,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
        adrNr: membersTable.adrNr,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        kurzname: membersTable.kurzname,
        firma1: membersTable.firma1,
        ort: membersTable.ort,
        austritt: membersTable.austritt,
        verstorbenAm: membersTable.verstorbenAm,
      })
      .from(membersTable)
      .where(inArray(membersTable.id, [...nodeIds]));

    const nodes = memberRows.map((m) => ({
      id: m.id,
      reference: memberRef(m),
      name: memberDisplayName(m),
      ort: m.ort,
      isMember: m.memberNo != null,
      inactive: m.austritt != null || m.verstorbenAm != null,
    }));

    return { nodes, edges: [...edgeMap.values()], capped };
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
      const like = `%${escapeLike(q)}%`;
      const rows = await context.db
        .select({
          id: membersTable.id,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          vorname: membersTable.vorname,
          nachname: membersTable.nachname,
          plz: membersTable.plz,
          ort: membersTable.ort,
        })
        .from(membersTable)
        .where(
          sql`(${membersTable.nachname} ilike ${like} or ${membersTable.vorname} ilike ${like} or ${membersTable.memberNo} ilike ${like} or ${membersTable.kontaktNo} ilike ${like} or ${membersTable.mitgliedsnummer} ilike ${like}) and ${membersTable.deletedAt} is null`,
        )
        .limit(20);
      return input.excludeMemberId ? rows.filter((r) => r.id !== input.excludeMemberId) : rows;
    }),
};
