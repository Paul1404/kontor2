import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import { matchBankTransactions, type OpenPosting, parseBankCsv } from "~/server/bank/reconcile";
import type { DB } from "~/server/db/client";
import { memberNotDeleted } from "~/server/db/member-filters";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { memberDisplayName, memberRef } from "~/server/domain/member";
import { vorstandProc } from "~/server/orpc/base";
import { invalidateDashboardCaches } from "~/server/search/cache";

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
  /** Parse a bank CSV and propose matches against open postings. No writes. */
  matchBankCsv: vorstandProc
    .input(v.object({ csv: v.pipe(v.string(), v.minLength(1)) }))
    .handler(async ({ context, input }) => {
      const parsed = parseBankCsv(input.csv);
      const postings = await loadOpenPostings(context.db);
      const proposals = matchBankTransactions(parsed.rows, postings);
      return {
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
      const result = await context.db.transaction(async (tx) => {
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
          await appendAudit(tx, {
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
          applied += 1;
        }
        return { applied, skipped };
      });
      // Payments change revenue and Zahlungsquote on the dashboard.
      await invalidateDashboardCaches(context.tenant.key);
      return result;
    }),
};

// Keep sql import used if future raw filters are added.
void sql;
