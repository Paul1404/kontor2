import { ORPCError } from "@orpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit, diff } from "~/server/audit/log";
import { withUniqueRetry } from "~/server/db/retry";
import { membersTable } from "~/server/db/schema/members";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { planMandatNachtrag } from "~/server/domain/mandat-nachtrag";
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

const CreateInput = v.object({
  memberId: v.string(),
  mandatsNr: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  status: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
});

const UpdateInput = v.object({
  status: v.optional(v.nullable(v.string())),
  lastschriftart: v.optional(v.nullable(v.string())),
  typ: v.optional(v.nullable(v.string())),
  unterschriftDatum: v.optional(v.nullable(v.string())),
  gueltigAb: v.optional(v.nullable(v.string())),
  gultigBis: v.optional(v.nullable(v.string())),
  widerrufenAm: v.optional(v.nullable(v.string())),
});

export const sepaRouter = {
  create: vorstandProc.input(CreateInput).handler(async ({ context, input }) => {
    // Auto-generated `M{seq}` mandate refs race under concurrency: two
    // creates for the same member can read the same max and collide on the
    // (adrNr, mandatsNr) unique index. Retry re-reads the max and picks the
    // next free suffix. A user-supplied duplicate is caught explicitly below
    // and surfaces as a friendly CONFLICT instead of being retried.
    return await withUniqueRetry(() =>
      context.db.transaction(async (tx) => {
        const [member] = await tx
          .select({ id: membersTable.id, adrNr: membersTable.adrNr })
          .from(membersTable)
          .where(eq(membersTable.id, input.memberId))
          .limit(1);
        if (!member) {
          throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
        }

        let mandatsNr = input.mandatsNr?.trim();
        if (mandatsNr) {
          const [dupe] = await tx
            .select({ id: sepaMandatesTable.id })
            .from(sepaMandatesTable)
            .where(
              and(
                eq(sepaMandatesTable.adrNr, member.adrNr),
                eq(sepaMandatesTable.mandatsNr, mandatsNr),
              ),
            )
            .limit(1);
          if (dupe) {
            throw new ORPCError("CONFLICT", {
              message: `Mandatsreferenz ${mandatsNr} ist für dieses Mitglied bereits vergeben.`,
            });
          }
        } else {
          // Generate `M{seq}` where seq is the next integer suffix not yet
          // used for this member. Keeps the format short and predictable,
          // and avoids collisions with the Linear-imported numeric mandate
          // refs.
          const [maxRow] = await tx
            .select({
              maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
            })
            .from(sepaMandatesTable)
            .where(eq(sepaMandatesTable.memberId, member.id));
          mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
        }

        const values = {
          memberId: member.id,
          adrNr: member.adrNr,
          mandatsNr,
          lastschriftart: input.lastschriftart ?? null,
          typ: input.typ ?? null,
          status: input.status ?? null,
          angelegtAm: new Date(),
          unterschriftDatum: toDateOrNull(input.unterschriftDatum, "Unterschriftsdatum"),
          gueltigAb: toDateOrNull(input.gueltigAb, "Gültig ab"),
          gultigBis: toDateOrNull(input.gultigBis, "Gültig bis"),
        };

        const [row] = await tx
          .insert(sepaMandatesTable)
          .values(values as never)
          .returning({ id: sepaMandatesTable.id });
        if (!row) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Anlage fehlgeschlagen." });
        }

        const auditId = await appendAudit(tx, {
          entityType: "sepa_mandate",
          entityId: row.id,
          action: "create",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: diff(null, values as Record<string, unknown>),
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, member.id, {
          trigger: "mutation",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          auditId,
        });

        return { id: row.id, mandatsNr };
      }),
    );
  }),

  update: vorstandProc
    .input(v.object({ id: v.string(), patch: UpdateInput }))
    .handler(async ({ context, input }) => {
      await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(sepaMandatesTable)
          .where(eq(sepaMandatesTable.id, input.id))
          .limit(1);
        if (!existing) {
          throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
        }
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ("status" in input.patch) patch.status = input.patch.status ?? null;
        if ("lastschriftart" in input.patch)
          patch.lastschriftart = input.patch.lastschriftart ?? null;
        if ("typ" in input.patch) patch.typ = input.patch.typ ?? null;
        if ("unterschriftDatum" in input.patch)
          patch.unterschriftDatum = toDateOrNull(
            input.patch.unterschriftDatum,
            "Unterschriftsdatum",
          );
        if ("gueltigAb" in input.patch)
          patch.gueltigAb = toDateOrNull(input.patch.gueltigAb, "Gültig ab");
        if ("gultigBis" in input.patch)
          patch.gultigBis = toDateOrNull(input.patch.gultigBis, "Gültig bis");
        if ("widerrufenAm" in input.patch)
          patch.widerrufenAm = toDateOrNull(input.patch.widerrufenAm, "Widerrufen am");

        const projected: Record<string, unknown> = {
          ...(existing as Record<string, unknown>),
          ...patch,
        };

        await tx
          .update(sepaMandatesTable)
          .set(patch as never)
          .where(eq(sepaMandatesTable.id, input.id));

        const changes = diff(existing as unknown as Record<string, unknown>, projected);
        if (Object.keys(changes).length > 0) {
          const auditId = await appendAudit(tx, {
            entityType: "sepa_mandate",
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

  /**
   * Soft-revoke: sets `widerrufen_am` to now and `is_deleted=true` so the
   * mandate stays in the audit history but is excluded from active mandate
   * lookups. Hard deletion is intentionally not exposed -- once a mandate is
   * used for a Lastschrift it must remain referenceable for SEPA returns.
   */
  revoke: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(sepaMandatesTable)
        .where(eq(sepaMandatesTable.id, input.id))
        .limit(1);
      if (!existing) {
        throw new ORPCError("NOT_FOUND", { message: "Mandat nicht gefunden." });
      }
      const now = new Date();
      await tx
        .update(sepaMandatesTable)
        .set({ widerrufenAm: now, isDeleted: true, updatedAt: now } as never)
        .where(eq(sepaMandatesTable.id, input.id));
      const auditId = await appendAudit(tx, {
        entityType: "sepa_mandate",
        entityId: input.id,
        action: "update",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: {
          widerrufenAm: {
            before: existing.widerrufenAm?.toISOString() ?? null,
            after: now.toISOString(),
          },
          isDeleted: { before: existing.isDeleted ?? false, after: true },
        },
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

  /**
   * Kandidaten für "Mandate nachtragen": lebende Mitglieder mit aktivem
   * Lastschrift-Vertrag (Betrag > 0), aber ohne nutzbares SEPA-Mandat.
   * Pro Mitglied steht der Plan dabei (nachtragen, reaktivieren oder
   * überspringen mit Grund) -- siehe `planMandatNachtrag` für die Regeln.
   */
  nachtragKandidaten: vorstandProc.input(v.void()).handler(async ({ context }) => {
    const members = await context.db
      .select({
        id: membersTable.id,
        memberNo: membersTable.memberNo,
        kontaktNo: membersTable.kontaktNo,
        mitgliedsnummer: membersTable.mitgliedsnummer,
        vorname: membersTable.vorname,
        nachname: membersTable.nachname,
        eintritt: membersTable.eintritt,
        hasIban: sql<boolean>`${membersTable.iban1} is not null`,
      })
      .from(membersTable)
      .where(
        sql`${membersTable.deletedAt} is null
          and (${membersTable.austritt} is null or ${membersTable.austritt}::date > current_date)
          and exists (
            select 1 from contracts c
            where c.member_id = ${membersTable.id} and c.is_direct_debit = true
              and (c.vertrag_ende is null or c.vertrag_ende > now()) and c.betrag > 0
          )
          and not exists (
            select 1 from ${sepaMandatesTable} sm
            where sm.member_id = ${membersTable.id}
              and sm.is_deleted = false and sm.widerrufen_am is null
              and (sm.status is null or btrim(sm.status) = '' or lower(sm.status) = 'aktiv')
              and (sm.gultig_bis is null or sm.gultig_bis >= current_date)
          )`,
      )
      .orderBy(membersTable.nachname, membersTable.vorname);

    if (members.length === 0) return [];
    const mandateRows = await context.db
      .select({
        id: sepaMandatesTable.id,
        memberId: sepaMandatesTable.memberId,
        mandatsNr: sepaMandatesTable.mandatsNr,
        isDeleted: sepaMandatesTable.isDeleted,
        widerrufenAm: sepaMandatesTable.widerrufenAm,
        status: sepaMandatesTable.status,
        gultigBis: sepaMandatesTable.gultigBis,
        angelegtAm: sepaMandatesTable.angelegtAm,
      })
      .from(sepaMandatesTable)
      .where(
        inArray(
          sepaMandatesTable.memberId,
          members.map((m) => m.id),
        ),
      );

    return members.map((m) => {
      const mandate = mandateRows.filter((r) => r.memberId === m.id);
      const plan = planMandatNachtrag({
        eintritt: m.eintritt,
        mandate: mandate.map((r) => ({ ...r, isDeleted: r.isDeleted ?? false })),
      });
      return {
        memberId: m.id,
        reference: m.memberNo ?? m.kontaktNo ?? m.mitgliedsnummer ?? "",
        name: [m.nachname, m.vorname].filter(Boolean).join(", "),
        eintritt: m.eintritt,
        hasIban: m.hasIban,
        plan,
        ...(plan.kind === "reactivate"
          ? { mandatsNr: mandate.find((r) => r.id === plan.mandateId)?.mandatsNr ?? null }
          : {}),
      };
    });
  }),

  /**
   * Führt das Nachtragen für die übergebenen Mitglieder aus. Der Plan wird
   * serverseitig neu berechnet (nie dem Client geglaubt): `create` legt ein
   * Mandat mit Unterschriftsdatum = Eintrittsdatum an, `reactivate` leert das
   * Gültig-bis des jüngsten nie widerrufenen Mandats. Alles auditiert plus
   * Mitglieds-Snapshot, wie bei manueller Anlage.
   */
  mandateNachtragen: vorstandProc
    .input(v.object({ memberIds: v.pipe(v.array(v.string()), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const results: Array<{ memberId: string; action: string; detail?: string }> = [];
      for (const memberId of [...new Set(input.memberIds)]) {
        const result = await withUniqueRetry(() =>
          context.db.transaction(async (tx) => {
            const [member] = await tx
              .select({
                id: membersTable.id,
                adrNr: membersTable.adrNr,
                eintritt: membersTable.eintritt,
              })
              .from(membersTable)
              .where(eq(membersTable.id, memberId))
              .limit(1);
            if (!member) return { action: "skip", detail: "Mitglied nicht gefunden" };

            const mandate = await tx
              .select({
                id: sepaMandatesTable.id,
                isDeleted: sepaMandatesTable.isDeleted,
                widerrufenAm: sepaMandatesTable.widerrufenAm,
                status: sepaMandatesTable.status,
                gultigBis: sepaMandatesTable.gultigBis,
                angelegtAm: sepaMandatesTable.angelegtAm,
              })
              .from(sepaMandatesTable)
              .where(eq(sepaMandatesTable.memberId, memberId));
            const plan = planMandatNachtrag({
              eintritt: member.eintritt,
              mandate: mandate.map((r) => ({ ...r, isDeleted: r.isDeleted ?? false })),
            });

            if (plan.kind === "skip") return { action: "skip", detail: plan.reason };

            if (plan.kind === "reactivate") {
              const [existing] = await tx
                .select()
                .from(sepaMandatesTable)
                .where(eq(sepaMandatesTable.id, plan.mandateId))
                .limit(1);
              if (!existing) return { action: "skip", detail: "Mandat nicht gefunden" };
              const now = new Date();
              await tx
                .update(sepaMandatesTable)
                .set({ gultigBis: null, status: "Aktiv", updatedAt: now } as never)
                .where(eq(sepaMandatesTable.id, plan.mandateId));
              const auditId = await appendAudit(tx, {
                entityType: "sepa_mandate",
                entityId: plan.mandateId,
                action: "update",
                source: "ui",
                actorId: context.session!.user.id,
                actorEmail: context.session!.user.email,
                changes: {
                  gultigBis: {
                    before: existing.gultigBis?.toISOString() ?? null,
                    after: null,
                  },
                  status: { before: existing.status, after: "Aktiv" },
                  nachtrag: {
                    before: null,
                    after: "Reaktiviert: Gültig-bis war Import-Artefakt, Mandat durchgehend genutzt",
                  },
                },
                requestId: context.requestId ?? null,
              });
              await takeMemberSnapshot(tx, memberId, {
                trigger: "mutation",
                actorId: context.session!.user.id,
                actorEmail: context.session!.user.email,
                auditId,
              });
              return { action: "reactivated", detail: existing.mandatsNr ?? undefined };
            }

            // create: Mandat aus der Beitrittserklärung nachtragen.
            const [maxRow] = await tx
              .select({
                maxSeq: sql<number>`coalesce(max(nullif(regexp_replace(${sepaMandatesTable.mandatsNr}, '\\D', '', 'g'), '')::int), 0)::int`,
              })
              .from(sepaMandatesTable)
              .where(eq(sepaMandatesTable.memberId, memberId));
            const mandatsNr = `M${(maxRow?.maxSeq ?? 0) + 1}`;
            const values = {
              memberId,
              adrNr: member.adrNr,
              mandatsNr,
              status: "Aktiv",
              angelegtAm: new Date(),
              unterschriftDatum: member.eintritt,
              gueltigAb: member.eintritt,
              gultigBis: null,
            };
            const [row] = await tx
              .insert(sepaMandatesTable)
              .values(values as never)
              .returning({ id: sepaMandatesTable.id });
            if (!row) return { action: "skip", detail: "Anlage fehlgeschlagen" };
            const auditId = await appendAudit(tx, {
              entityType: "sepa_mandate",
              entityId: row.id,
              action: "create",
              source: "ui",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              changes: {
                ...diff(null, values as Record<string, unknown>),
                nachtrag: {
                  before: null,
                  after: "Nachgetragen aus Beitrittserklärung (Unterschrift = Eintrittsdatum)",
                },
              },
              requestId: context.requestId ?? null,
            });
            await takeMemberSnapshot(tx, memberId, {
              trigger: "mutation",
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              auditId,
            });
            return { action: "created", detail: mandatsNr };
          }),
        );
        results.push({ memberId, ...result });
      }
      return {
        created: results.filter((r) => r.action === "created").length,
        reactivated: results.filter((r) => r.action === "reactivated").length,
        skipped: results.filter((r) => r.action === "skip").length,
        results,
      };
    }),
};
