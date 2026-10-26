import { ORPCError } from "@orpc/server";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { memberAbteilungenTable } from "~/server/db/schema/abteilungen";
import { contractsTable } from "~/server/db/schema/contracts";
import { dunningItemsTable } from "~/server/db/schema/dunning";
import { familienMitgliederTable } from "~/server/db/schema/familien";
import { feeRunItemsTable, sollStellungenTable } from "~/server/db/schema/fee-runs";
import { membersTable } from "~/server/db/schema/members";
import { portalSessionsTable, portalTokensTable } from "~/server/db/schema/portal";
import { sepaMandatesTable } from "~/server/db/schema/sepa";
import { generateMemberNumber } from "~/server/domain/member-number";
import { vorstandProc } from "~/server/orpc/base";
import { invalidateMemberCaches } from "~/server/search/cache";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

async function preview(db: DBOrTx, memberId: string) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member || member.deletedAt)
    throw new ORPCError("NOT_FOUND", { message: "Mitglied nicht gefunden." });
  const [
    [contracts],
    [departments],
    [postings],
    [families],
    [mandates],
    [sessions],
    [tokens],
    [dunning],
    [runs],
  ] = await Promise.all([
    db.select({ n: count() }).from(contractsTable).where(eq(contractsTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(memberAbteilungenTable)
      .where(eq(memberAbteilungenTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(sollStellungenTable)
      .where(eq(sollStellungenTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(familienMitgliederTable)
      .where(
        and(eq(familienMitgliederTable.memberId, memberId), isNull(familienMitgliederTable.bis)),
      ),
    db
      .select({ n: count() })
      .from(sepaMandatesTable)
      .where(eq(sepaMandatesTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(portalSessionsTable)
      .where(eq(portalSessionsTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(portalTokensTable)
      .where(eq(portalTokensTable.memberId, memberId)),
    db
      .select({ n: count() })
      .from(dunningItemsTable)
      .where(eq(dunningItemsTable.memberId, memberId)),
    db.select({ n: count() }).from(feeRunItemsTable).where(eq(feeRunItemsTable.memberId, memberId)),
  ]);
  const blockers: string[] = [];
  if (!member.memberNo) blockers.push("Dieser Datensatz ist bereits ein Kontakt.");
  if (member.austritt || member.verstorbenAm)
    blockers.push("Ehemalige Mitglieder behalten ihre Mitgliedshistorie.");
  if (contracts!.n) blockers.push("Eigene Verträge müssen zuerst fachlich geklärt werden.");
  if (departments!.n) blockers.push("Abteilungszuordnungen müssen zuerst fachlich geklärt werden.");
  if (dunning!.n || runs!.n)
    blockers.push(
      "Vorhandene Mahnungen oder Beitragslaufpositionen verhindern die automatische Konvertierung.",
    );
  if (postings!.n)
    blockers.push(
      "Vorhandene Sollstellungen und ihre Zahlungs- und Mahnhistorie verhindern die Konvertierung.",
    );
  return {
    memberId,
    memberNo: member.memberNo,
    kontaktNo: generateMemberNumber("kontakt"),
    updatedAt: member.updatedAt?.toISOString(),
    blockers,
    counts: {
      contracts: contracts!.n,
      departments: departments!.n,
      postings: postings!.n,
      dunning: dunning!.n,
      runs: runs!.n,
      families: families!.n,
      mandates: mandates!.n,
      portal: sessions!.n + tokens!.n,
    },
  };
}
const Input = v.object({ memberId: v.pipe(v.string(), v.uuid()) });
export const memberConversionRouter = {
  preview: vorstandProc
    .input(Input)
    .handler(({ context, input }) => preview(context.db, input.memberId)),
  commit: vorstandProc
    .input(
      v.object({
        memberId: v.pipe(v.string(), v.uuid()),
        expectedUpdatedAt: v.string(),
        kontaktNo: v.pipe(v.string(), v.regex(/^K-[0-9A-HJKMNP-TV-Z]{6}$/)),
        reason: v.pipe(v.string(), v.trim(), v.minLength(5)),
        confirm: v.literal(true),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        await tx.execute(sql`select id from members where id=${input.memberId} for update`);
        const plan = await preview(tx, input.memberId);
        if (plan.updatedAt !== input.expectedUpdatedAt)
          throw new ORPCError("CONFLICT", {
            message: "Daten wurden geändert. Vorschau neu laden.",
          });
        if (plan.blockers.length)
          throw new ORPCError("CONFLICT", { message: plan.blockers.join(" ") });
        const kontaktNo = input.kontaktNo;
        await tx
          .update(membersTable)
          .set({
            previousMemberNo: plan.memberNo,
            memberNo: null,
            kontaktNo,
            updatedAt: new Date(),
          })
          .where(eq(membersTable.id, input.memberId));
        await tx
          .update(portalSessionsTable)
          .set({ revokedAt: new Date() })
          .where(eq(portalSessionsTable.memberId, input.memberId));
        await tx.delete(portalTokensTable).where(eq(portalTokensTable.memberId, input.memberId));
        const auditId = await appendAudit(tx, {
          entityType: "member",
          entityId: input.memberId,
          action: "update",
          source: "ui",
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
          changes: {
            memberNo: { before: plan.memberNo, after: null },
            kontaktNo: { before: null, after: kontaktNo },
            conversionReason: { before: null, after: input.reason },
          },
          requestId: context.requestId ?? null,
        });
        await takeMemberSnapshot(tx, input.memberId, {
          trigger: "mutation",
          auditId,
          actorId: context.session!.user.id,
          actorEmail: context.session!.user.email,
        });
        return { kontaktNo };
      });
      await invalidateMemberCaches(context.tenant.key);
      return result;
    }),
};
