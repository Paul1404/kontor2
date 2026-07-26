import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import {
  matchBankTransactions,
  type OpenPosting,
  parseBankCsv,
  searchOpenPostings,
} from "~/server/bank/reconcile";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { idempotencyKeysTable } from "~/server/db/schema/idempotency";
import { membersTable } from "~/server/db/schema/members";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { vorstandProc } from "~/server/orpc/base";
import { invalidateDashboardCaches } from "~/server/search/cache";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

const cents = (n: number) => Math.round(n * 100);
const toAmount = (c: number) => (c / 100).toFixed(2);

async function loadOpenPostings(db: DB): Promise<OpenPosting[]> {
  const rows = await db
    .select({
      sollStellungId: sollStellungenTable.id,
      memberId: membersTable.id,
      billingYear: sollStellungenTable.billingYear,
      openAmount: sollStellungenTable.openAmount,
      memberNo: membersTable.memberNo,
      kontaktNo: membersTable.kontaktNo,
      mitgliedsnummer: membersTable.mitgliedsnummer,
      adrNr: membersTable.adrNr,
      vorname: membersTable.vorname,
      nachname: membersTable.nachname,
      kurzname: membersTable.kurzname,
      firma1: membersTable.firma1,
    })
    .from(sollStellungenTable)
    .innerJoin(membersTable, eq(membersTable.id, sollStellungenTable.memberId))
    .where(
      and(
        inArray(sollStellungenTable.status, ["open", "returned"]),
        gt(sollStellungenTable.openAmount, "0"),
        memberNotDeleted(),
      ),
    );
  return rows.map((r) => ({
    sollStellungId: r.sollStellungId,
    memberId: r.memberId,
    reference: memberRef(r),
    mitgliedsnummer: r.mitgliedsnummer,
    nachname: r.nachname,
    memberName: memberDisplayName(r),
    billingYear: r.billingYear,
    openAmount: Number.parseFloat(r.openAmount),
  }));
}

export const paymentsRouter = {
  /** Search open postings so an administrator can correct an automatic match. */
  openPostings: vorstandProc
    .input(
      v.optional(
        v.object({
          query: v.optional(v.string(), ""),
          limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 30),
        }),
        {},
      ),
    )
    .handler(async ({ context, input }) => {
      const postings = await loadOpenPostings(context.db);
      return searchOpenPostings(postings, input.query, input.limit).map((posting) => ({
        sollStellungId: posting.sollStellungId,
        memberName: posting.memberName,
        reference: posting.reference,
        billingYear: posting.billingYear,
        openAmount: posting.openAmount,
      }));
    }),

  /** Parse a bank CSV and propose matches against open postings. No writes. */
  matchBankCsv: vorstandProc
    .input(v.object({ csv: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const parsed = parseBankCsv(input.csv);
      const postings = await loadOpenPostings(context.db);
      const proposals = matchBankTransactions(parsed.rows, postings);
      return {
        sourceHash: createHash("sha256").update(input.csv).digest("hex"),
        warnings: parsed.warnings,
        totalRows: parsed.rows.length,
        proposals: proposals.map((p) => ({
          line: p.row.line,
          date: p.row.date,
          amount: p.row.amount,
          name: p.row.name,
          purpose: p.row.purpose,
          confidence: p.confidence,
          reason: p.reason,
          match: p.posting
            ? {
                sollStellungId: p.posting.sollStellungId,
                memberName: p.posting.memberName,
                reference: p.posting.reference,
                billingYear: p.posting.billingYear,
                openAmount: p.posting.openAmount,
              }
            : null,
        })),
      };
    }),

  /** Apply confirmed payments: reduce openAmount, mark fully covered as paid. */
  apply: vorstandProc
    .input(
      v.object({
        sourceHash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
        items: v.array(
          v.object({
            sollStellungId: v.pipe(v.string(), v.uuid()),
            amount: v.pipe(v.number(), v.minValue(0.01)),
          }),
        ),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.items.length === 0) {
        throw new ORPCError("BAD_REQUEST", { message: "Keine Zahlungen ausgewählt." });
      }
      // Collapse duplicate postings in one request: a posting must only be
      // booked once, so sum any repeated ids rather than applying twice.
      const byId = new Map<string, number>();
      for (const it of input.items) {
        byId.set(it.sollStellungId, (byId.get(it.sollStellungId) ?? 0) + it.amount);
      }
      const items = [...byId.entries()]
        .map(([sollStellungId, amount]) => ({ sollStellungId, amount }))
        // Sort by id so concurrent requests acquire row locks in the same
        // order, which rules out a deadlock between two overlapping batches.
        .sort((a, b) => a.sollStellungId.localeCompare(b.sollStellungId));
      const idempotencyKey = createHash("sha256")
        .update(
          JSON.stringify({
            sourceHash: input.sourceHash,
            items: items.map((item) => ({
              sollStellungId: item.sollStellungId,
              amountCents: cents(item.amount),
            })),
          }),
        )
        .digest("hex");
      const result = await context.db.transaction(async (tx) => {
        const [reservation] = await tx
          .insert(idempotencyKeysTable)
          .values({ scope: "payments.apply", key: idempotencyKey })
          .onConflictDoNothing()
          .returning({ id: idempotencyKeysTable.id });
        if (!reservation) {
          const [existing] = await tx
            .select({
              result: idempotencyKeysTable.result,
              completedAt: idempotencyKeysTable.completedAt,
            })
            .from(idempotencyKeysTable)
            .where(
              and(
                eq(idempotencyKeysTable.scope, "payments.apply"),
                eq(idempotencyKeysTable.key, idempotencyKey),
              ),
            )
            .limit(1);
          if (existing?.completedAt && existing.result) {
            return existing.result as { applied: number; skipped: number };
          }
          throw new ORPCError("CONFLICT", {
            message:
              "Diese Bankbuchungen werden bereits verarbeitet. Bitte versuchen Sie es erneut.",
          });
        }
        let applied = 0;
        let skipped = 0;
        for (const item of items) {
          // Lock the posting row (FOR UPDATE) so a concurrent apply on the same
          // Sollstellung blocks until this transaction commits, then reads the
          // updated openAmount. Without the lock both transactions read the same
          // open balance and the second overwrites the first (lost payment).
          const [soll] = await tx
            .select()
            .from(sollStellungenTable)
            .where(eq(sollStellungenTable.id, item.sollStellungId))
            .limit(1)
            .for("update");
          if (!soll || (soll.status !== "open" && soll.status !== "returned")) {
            skipped += 1;
            continue;
          }
          const openCents = cents(Number.parseFloat(soll.openAmount));
          const payCents = Math.min(cents(item.amount), openCents);
          const newOpenCents = openCents - payCents;
          const newPaidCents = cents(Number.parseFloat(soll.paidAmount)) + payCents;
          const newStatus = newOpenCents <= 0 ? "paid" : soll.status;
          await tx
            .update(sollStellungenTable)
            .set({
              paidAmount: toAmount(newPaidCents),
              openAmount: toAmount(newOpenCents),
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(sollStellungenTable.id, item.sollStellungId));
          const auditId = await appendAudit(tx, {
            entityType: "member",
            entityId: soll.memberId,
            action: "update",
            source: "ui",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            changes: {
              zahlungseingang: { before: null, after: toAmount(payCents) },
              paidAmount: { before: soll.paidAmount, after: toAmount(newPaidCents) },
              openAmount: { before: soll.openAmount, after: toAmount(newOpenCents) },
              status: { before: soll.status, after: newStatus },
              billingYear: { before: null, after: soll.billingYear },
            },
            requestId: context.requestId ?? null,
          });
          await takeMemberSnapshot(tx, soll.memberId, {
            trigger: "mutation",
            actorId: context.session!.user.id,
            actorEmail: context.session!.user.email,
            auditId,
          });
          applied += 1;
        }
        const result = { applied, skipped };
        await tx
          .update(idempotencyKeysTable)
          .set({ result, completedAt: new Date() })
          .where(eq(idempotencyKeysTable.id, reservation.id));
        return result;
      });
      // Payments change revenue and Zahlungsquote on the dashboard.
      await invalidateDashboardCaches(context.tenant.key);
      return result;
    }),
};
