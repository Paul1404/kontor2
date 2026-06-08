import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { matchCamtReturns, parseCamt054, type ReturnableItem } from "~/server/bank/camt054";
import type { DB } from "~/server/db/client";
import { escapeLike } from "~/server/db/like";
import { sepaReturnsTable } from "~/server/db/schema/dunning";
import { feeRunItemsTable, feeRunsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { organizationSettingsTable } from "~/server/db/schema/organization-settings";
import { memberRef } from "~/server/domain/member";
import { authedProc, vorstandProc } from "~/server/orpc/base";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

type ReturnItemRef = { id: string; memberId: string; sollStellungId: string | null };

/**
 * Record one SEPA return inside a transaction: claim the fee_run_item (so a
 * double-submit cannot reopen the same posting twice), insert the sepa_returns
 * row, reopen the linked Sollstellung, and write the audit entry. Returns the
 * new return id, or null when the item had already been returned.
 *
 * Reopening resets `mahnstufe` to 0: a freshly failed collection must restart
 * the Mahnwesen at the Erinnerung, not jump in at whatever level the posting
 * happened to carry before.
 */
async function recordReturn(
  tx: Tx,
  actor: { actorId: string; actorEmail: string; requestId: string | null; source: "ui" | "import" },
  item: ReturnItemRef,
  data: {
    returnedOn: string;
    reasonCode: string | null;
    reasonText: string | null;
    rueckgebuhr: string;
    notes: string | null;
  },
): Promise<string | null> {
  const claimed = await tx
    .update(feeRunItemsTable)
    .set({ returnedAt: new Date(), returnReasonCode: data.reasonCode ?? null })
    .where(and(eq(feeRunItemsTable.id, item.id), isNull(feeRunItemsTable.returnedAt)))
    .returning({ id: feeRunItemsTable.id });
  if (claimed.length === 0) return null;

  const [row] = await tx
    .insert(sepaReturnsTable)
    .values({
      feeRunItemId: item.id,
      sollStellungId: item.sollStellungId,
      memberId: item.memberId,
      returnedOn: data.returnedOn,
      reasonCode: data.reasonCode,
      reasonText: data.reasonText,
      rueckgebuhr: data.rueckgebuhr,
      notes: data.notes,
      createdBy: actor.actorId,
    } as never)
    .returning({ id: sepaReturnsTable.id });

  // Reopen the Sollstellung: paid back to 0, status=returned, openAmount=full,
  // and the dunning ladder reset to 0.
  if (item.sollStellungId) {
    await tx
      .update(sollStellungenTable)
      .set({
        status: "returned",
        paidAmount: "0",
        openAmount: sql`${sollStellungenTable.amount}`,
        mahnstufe: 0,
        updatedAt: new Date(),
      })
      .where(eq(sollStellungenTable.id, item.sollStellungId));
  }

  await appendAudit(tx, {
    entityType: "sepa_return",
    entityId: row!.id,
    action: "create",
    source: actor.source,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    changes: {
      feeRunItemId: { before: null, after: item.id },
      reasonCode: { before: null, after: data.reasonCode },
      rueckgebuhr: { before: null, after: data.rueckgebuhr },
    },
    requestId: actor.requestId ?? null,
  });
  return row!.id;
}

const KnownReasonCodes = v.picklist([
  "AC04", // closed account
  "AC06", // blocked account
  "AC13", // invalid debtor account type
  "AG01", // transaction forbidden
  "AM04", // insufficient funds
  "AM05", // duplicate collection
  "BE05", // unrecognised initiating party
  "FF01", // operation/transaction code incorrect, invalid file format
  "MD01", // no mandate
  "MD06", // refund request by debtor
  "MD07", // debtor deceased
  "MS02", // refusal by debtor
  "MS03", // reason not specified
  "RC01", // bank identifier incorrect
  "RR01", // missing debtor name or address
  "SL01", // specific service offered by debtor agent
] as const);

const MoneyString = v.pipe(v.string(), v.regex(/^-?\d+(\.\d{1,2})?$/));

const CreateInput = v.object({
  feeRunItemId: v.string(),
  returnedOn: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
  reasonCode: v.optional(v.nullable(KnownReasonCodes), null),
  reasonText: v.optional(v.nullable(v.string()), null),
  rueckgebuhr: v.optional(MoneyString, "0"),
  notes: v.optional(v.nullable(v.string()), null),
});

export const sepaReturnsRouter = {
  list: authedProc
    .input(
      v.optional(
        v.object({
          page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)), 1),
          pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
          memberId: v.optional(v.nullable(v.string()), null),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const where = input.memberId ? eq(sepaReturnsTable.memberId, input.memberId) : undefined;
      const offset = (input.page - 1) * input.pageSize;
      const [rows, totals] = await Promise.all([
        context.db
          .select({
            id: sepaReturnsTable.id,
            feeRunItemId: sepaReturnsTable.feeRunItemId,
            memberId: sepaReturnsTable.memberId,
            sollStellungId: sepaReturnsTable.sollStellungId,
            returnedOn: sepaReturnsTable.returnedOn,
            reasonCode: sepaReturnsTable.reasonCode,
            reasonText: sepaReturnsTable.reasonText,
            rueckgebuhr: sepaReturnsTable.rueckgebuhr,
            notes: sepaReturnsTable.notes,
            createdAt: sepaReturnsTable.createdAt,
            amount: feeRunItemsTable.amount,
            sequenceType: feeRunItemsTable.sequenceType,
            billingYear: feeRunsTable.billingYear,
            memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
            memberNo: membersTable.memberNo,
            kontaktNo: membersTable.kontaktNo,
            mitgliedsnummer: membersTable.mitgliedsnummer,
            adrNr: membersTable.adrNr,
          })
          .from(sepaReturnsTable)
          .innerJoin(feeRunItemsTable, eq(sepaReturnsTable.feeRunItemId, feeRunItemsTable.id))
          .innerJoin(feeRunsTable, eq(feeRunItemsTable.feeRunId, feeRunsTable.id))
          .innerJoin(membersTable, eq(sepaReturnsTable.memberId, membersTable.id))
          .where(where)
          .orderBy(desc(sepaReturnsTable.returnedOn), desc(sepaReturnsTable.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        context.db.select({ c: count() }).from(sepaReturnsTable).where(where),
      ]);
      return { rows, total: totals[0]?.c ?? 0 };
    }),

  /**
   * List committed fee_run_items that have not already been marked as
   * returned. Used by the "Rückläufer erfassen" form to pick a debit.
   */
  candidates: vorstandProc
    .input(
      v.optional(
        v.object({
          query: v.optional(v.nullable(v.string()), null),
          limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const q = (input.query ?? "").trim();
      const like = `%${escapeLike(q)}%`;
      const where = and(
        eq(feeRunsTable.status, "committed"),
        sql`${feeRunItemsTable.returnedAt} is null`,
        q
          ? sql`(
              ${membersTable.mitgliedsnummer} ilike ${like} or
              ${membersTable.nachname} ilike ${like} or
              ${membersTable.vorname} ilike ${like} or
              ${membersTable.firma1} ilike ${like} or
              ${feeRunItemsTable.endToEndId} ilike ${like}
            )`
          : sql`true`,
      );
      const rows = await context.db
        .select({
          itemId: feeRunItemsTable.id,
          billingYear: feeRunsTable.billingYear,
          amount: feeRunItemsTable.amount,
          purpose: feeRunItemsTable.purpose,
          endToEndId: feeRunItemsTable.endToEndId,
          sequenceType: feeRunItemsTable.sequenceType,
          mandateRef: feeRunItemsTable.mandateRef,
          debtorIbanLast4: feeRunItemsTable.debtorIbanLast4,
          memberId: feeRunItemsTable.memberId,
          memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
          memberNo: membersTable.memberNo,
          kontaktNo: membersTable.kontaktNo,
          mitgliedsnummer: membersTable.mitgliedsnummer,
          adrNr: membersTable.adrNr,
        })
        .from(feeRunItemsTable)
        .innerJoin(feeRunsTable, eq(feeRunItemsTable.feeRunId, feeRunsTable.id))
        .innerJoin(membersTable, eq(feeRunItemsTable.memberId, membersTable.id))
        .where(where)
        .orderBy(desc(feeRunsTable.billingYear), membersTable.nachname)
        .limit(input.limit);
      return rows;
    }),

  create: vorstandProc.input(CreateInput).handler(async ({ context, input }) => {
    const [item] = await context.db
      .select({
        id: feeRunItemsTable.id,
        memberId: feeRunItemsTable.memberId,
        sollStellungId: feeRunItemsTable.sollStellungId,
        amount: feeRunItemsTable.amount,
        returnedAt: feeRunItemsTable.returnedAt,
      })
      .from(feeRunItemsTable)
      .where(eq(feeRunItemsTable.id, input.feeRunItemId))
      .limit(1);
    if (!item) {
      throw new ORPCError("NOT_FOUND", { message: "Lastschrift nicht gefunden." });
    }
    if (item.returnedAt) {
      throw new ORPCError("CONFLICT", {
        message: "Diese Lastschrift wurde bereits als Rückläufer erfasst.",
      });
    }

    // Default Rücklastgebühr falls back to org setting.
    let gebuhr = input.rueckgebuhr;
    if (!gebuhr || gebuhr === "0") {
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      if (org?.sepaReturnFee && org.sepaReturnFee !== "0") gebuhr = org.sepaReturnFee;
    }

    const result = await context.db.transaction(async (tx) => {
      const id = await recordReturn(
        tx,
        {
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          requestId: context.requestId ?? null,
          source: "ui",
        },
        item,
        {
          returnedOn: input.returnedOn,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          rueckgebuhr: gebuhr,
          notes: input.notes,
        },
      );
      if (!id) {
        throw new ORPCError("CONFLICT", {
          message: "Diese Lastschrift wurde bereits als Rückläufer erfasst.",
        });
      }
      return id;
    });

    return { id: result };
  }),

  /**
   * Parse an uploaded camt.054 (Rücklastschrift) file and match each returned
   * debit to a committed fee_run_item by EndToEndId. No writes -- the operator
   * confirms the matched set, then calls `importCamt`.
   */
  previewCamt: vorstandProc
    .input(v.object({ xml: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const parsed = parseCamt054(input.xml);

      const e2eIds = parsed.returns
        .map((r) => r.endToEndId)
        .filter((id): id is string => !!id && id.length > 0);

      const items =
        e2eIds.length === 0
          ? []
          : await context.db
              .select({
                feeRunItemId: feeRunItemsTable.id,
                endToEndId: feeRunItemsTable.endToEndId,
                amount: feeRunItemsTable.amount,
                returnedAt: feeRunItemsTable.returnedAt,
                billingYear: feeRunsTable.billingYear,
                memberName: sql<string>`coalesce(${membersTable.vorname} || ' ' || ${membersTable.nachname}, ${membersTable.kurzname}, ${membersTable.firma1}, 'AdrNr ' || ${membersTable.adrNr})`,
                memberNo: membersTable.memberNo,
                kontaktNo: membersTable.kontaktNo,
                mitgliedsnummer: membersTable.mitgliedsnummer,
                adrNr: membersTable.adrNr,
              })
              .from(feeRunItemsTable)
              .innerJoin(feeRunsTable, eq(feeRunItemsTable.feeRunId, feeRunsTable.id))
              .innerJoin(membersTable, eq(feeRunItemsTable.memberId, membersTable.id))
              .where(inArray(feeRunItemsTable.endToEndId, e2eIds));

      const refByItem = new Map(items.map((i) => [i.feeRunItemId, i]));
      const returnable: ReturnableItem[] = items.map((i) => ({
        feeRunItemId: i.feeRunItemId,
        endToEndId: i.endToEndId,
        amount: i.amount,
        alreadyReturned: i.returnedAt != null,
      }));

      const matches = matchCamtReturns(parsed.returns, returnable);
      let matched = 0;
      let alreadyReturned = 0;
      let unmatched = 0;
      const rows = matches.map((m, idx) => {
        if (m.status === "matched") matched += 1;
        else if (m.status === "already_returned") alreadyReturned += 1;
        else unmatched += 1;
        const ref = m.item ? refByItem.get(m.item.feeRunItemId) : null;
        return {
          index: idx,
          status: m.status,
          endToEndId: m.ret.endToEndId,
          amount: m.ret.amount,
          reasonCode: m.ret.reasonCode,
          reasonText: m.ret.reasonText,
          returnedOn: m.ret.returnedOn,
          debtorName: m.ret.debtorName,
          feeRunItemId: m.item?.feeRunItemId ?? null,
          member: ref
            ? {
                name: ref.memberName,
                ref: memberRef(ref),
                billingYear: ref.billingYear,
                amount: ref.amount,
              }
            : null,
        };
      });

      return {
        warnings: parsed.warnings,
        totals: { total: matches.length, matched, alreadyReturned, unmatched },
        rows,
      };
    }),

  /**
   * Apply confirmed camt.054 matches: record one return per fee_run_item,
   * reopening each Sollstellung. Skips any item already returned. The
   * Rücklastgebühr falls back to the org-wide default unless overridden.
   */
  importCamt: vorstandProc
    .input(
      v.object({
        items: v.pipe(
          v.array(
            v.object({
              feeRunItemId: v.string(),
              returnedOn: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
              reasonCode: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(35))), null),
              reasonText: v.optional(v.nullable(v.string()), null),
              rueckgebuhr: v.optional(v.nullable(MoneyString), null),
            }),
          ),
          v.minLength(1),
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      const [org] = await context.db.select().from(organizationSettingsTable).limit(1);
      const defaultFee = org?.sepaReturnFee && org.sepaReturnFee !== "0" ? org.sepaReturnFee : "0";

      const ids = input.items.map((i) => i.feeRunItemId);
      const items = await context.db
        .select({
          id: feeRunItemsTable.id,
          memberId: feeRunItemsTable.memberId,
          sollStellungId: feeRunItemsTable.sollStellungId,
        })
        .from(feeRunItemsTable)
        .where(inArray(feeRunItemsTable.id, ids));
      const itemById = new Map(items.map((i) => [i.id, i]));

      const out = await context.db.transaction(async (tx) => {
        let imported = 0;
        let skipped = 0;
        for (const want of input.items) {
          const item = itemById.get(want.feeRunItemId);
          if (!item) {
            skipped += 1;
            continue;
          }
          const id = await recordReturn(
            tx,
            {
              actorId: context.session!.user.id,
              actorEmail: context.session!.user.email,
              requestId: context.requestId ?? null,
              source: "import",
            },
            item,
            {
              returnedOn: want.returnedOn,
              reasonCode: want.reasonCode ?? null,
              reasonText: want.reasonText ?? null,
              rueckgebuhr: want.rueckgebuhr ?? defaultFee,
              notes: null,
            },
          );
          if (id) imported += 1;
          else skipped += 1;
        }
        return { imported, skipped };
      });

      return out;
    }),

  delete: vorstandProc.input(v.object({ id: v.string() })).handler(async ({ context, input }) => {
    const [row] = await context.db
      .select()
      .from(sepaReturnsTable)
      .where(eq(sepaReturnsTable.id, input.id))
      .limit(1);
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Rückläufer nicht gefunden." });

    await context.db.transaction(async (tx) => {
      await tx.delete(sepaReturnsTable).where(eq(sepaReturnsTable.id, input.id));
      // Best effort: clear the returned marker if no other returns reference this item.
      const [stillReturned] = await tx
        .select({ c: count() })
        .from(sepaReturnsTable)
        .where(eq(sepaReturnsTable.feeRunItemId, row.feeRunItemId));
      if ((stillReturned?.c ?? 0) === 0) {
        await tx
          .update(feeRunItemsTable)
          .set({ returnedAt: null, returnReasonCode: null })
          .where(eq(feeRunItemsTable.id, row.feeRunItemId));
      }

      // Restore the Sollstellung the return had reopened. Creating a return
      // forces the posting to returned/open; undoing it must put it back to
      // the collected state (eingezogen, fully paid) so it does not linger in
      // the dunning pipeline. Only do this if no other return still reopens
      // the same posting, and only while it is still in `returned` state so we
      // never clobber a status the vorstand changed in the meantime.
      if (row.sollStellungId) {
        const [otherReturns] = await tx
          .select({ c: count() })
          .from(sepaReturnsTable)
          .where(eq(sepaReturnsTable.sollStellungId, row.sollStellungId));
        if ((otherReturns?.c ?? 0) === 0) {
          await tx
            .update(sollStellungenTable)
            .set({
              status: "eingezogen",
              paidAmount: sql`${sollStellungenTable.amount}`,
              openAmount: "0",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(sollStellungenTable.id, row.sollStellungId),
                eq(sollStellungenTable.status, "returned"),
              ),
            );
        }
      }
      await appendAudit(tx, {
        entityType: "sepa_return",
        entityId: input.id,
        action: "delete",
        source: "ui",
        actorId: context.session!.user.id,
        actorEmail: context.session!.user.email,
        changes: { undone: { before: row.reasonCode ?? null, after: null } },
        requestId: context.requestId ?? null,
      });
    });

    return { ok: true };
  }),
};
