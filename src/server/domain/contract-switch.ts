import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { sollStellungenTable } from "~/server/db/schema/fee-runs";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import { membersTable } from "~/server/db/schema/members";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

export const ContractSwitchInput = v.object({
  contractId: v.pipe(v.string(), v.uuid()),
  art: v.number(),
  effectiveDate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)),
});
export async function planContractSwitch(
  db: DBOrTx,
  input: v.InferOutput<typeof ContractSwitchInput>,
) {
  const [old] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.id, input.contractId));
  const [tariff] = await db.select().from(feeTypesTable).where(eq(feeTypesTable.art, input.art));
  if (!old || !tariff)
    throw new ORPCError("NOT_FOUND", { message: "Vertrag oder Tarif nicht gefunden." });
  const [member] = await db
    .select({ memberNo: membersTable.memberNo, deletedAt: membersTable.deletedAt })
    .from(membersTable)
    .where(eq(membersTable.id, old.memberId));
  if (!member?.memberNo || member.deletedAt)
    throw new ORPCError("CONFLICT", {
      message: "Tarifwechsel sind nur für bestehende Mitglieder möglich.",
    });
  const date = new Date(`${input.effectiveDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.effectiveDate)
    throw new ORPCError("BAD_REQUEST", { message: "Ungültiges Wirksamkeitsdatum." });
  if (old.vertragEnde || old.gekuendZum)
    throw new ORPCError("CONFLICT", { message: "Der Vertrag ist bereits beendet." });
  if (old.vertragBegin && date <= old.vertragBegin)
    throw new ORPCError("CONFLICT", { message: "Der Wechsel muss nach Vertragsbeginn liegen." });
  if (
    tariff.nichAktiv === "J" ||
    tariff.betrag1 == null ||
    !Number.isFinite(Number(tariff.betrag1)) ||
    Number(tariff.betrag1) < 0
  )
    throw new ORPCError("CONFLICT", { message: "Der neue Tarif ist nicht abrechenbar." });
  const seriesId = old.seriesId ?? old.id;
  const postings = await db
    .select({
      id: sollStellungenTable.id,
      year: sollStellungenTable.billingYear,
      status: sollStellungenTable.status,
      amount: sollStellungenTable.amount,
    })
    .from(sollStellungenTable)
    .innerJoin(contractsTable, eq(contractsTable.id, sollStellungenTable.contractId))
    .where(
      and(
        sql`coalesce(${contractsTable.seriesId},${contractsTable.id})=${seriesId}`,
        sql`${sollStellungenTable.status}<>'cancelled'`,
      ),
    );
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        updatedAt: old.updatedAt,
        art: tariff.art,
        amount: tariff.betrag1,
        name: tariff.bezeichnung,
        schedule: tariff.sollstellung,
        active: tariff.nichAktiv,
        postings: postings.slice().sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return { old, tariff, date, seriesId, postings, revision };
}

export async function executeContractSwitch(
  db: DBOrTx,
  input: v.InferOutput<typeof ContractSwitchInput> & { revision: string },
  actor: { id: string; email: string; requestId?: string | null },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from contracts where id=${input.contractId} for update`);
    const p = await planContractSwitch(tx, input);
    if (p.revision !== input.revision)
      throw new ORPCError("CONFLICT", { message: "Vertrag geändert. Vorschau neu laden." });
    await tx
      .update(contractsTable)
      .set({ seriesId: p.seriesId, vertragEnde: p.date, updatedAt: new Date() })
      .where(eq(contractsTable.id, p.old.id));
    const [next] = await tx
      .insert(contractsTable)
      .values({
        memberId: p.old.memberId,
        adrNr: p.old.adrNr,
        vertragNr: `${p.old.vertragNr}.${input.effectiveDate}`,
        art: input.art,
        artName: p.tariff.bezeichnung,
        betrag: p.tariff.betrag1,
        sollstellung: p.tariff.sollstellung,
        isDirectDebit: p.old.isDirectDebit,
        zahlerMemberId: p.old.zahlerMemberId,
        abwKontoInh: p.old.abwKontoInh,
        seriesId: p.seriesId,
        vertragBegin: p.date,
      })
      .returning({ id: contractsTable.id });
    const auditId = await appendAudit(tx, {
      entityType: "contract",
      entityId: p.old.id,
      action: "update",
      source: "ui",
      actorId: actor.id,
      actorEmail: actor.email,
      changes: {
        vertragEnde: { before: null, after: input.effectiveDate },
        successor: { before: null, after: next!.id },
      },
      requestId: actor.requestId ?? null,
    });
    await takeMemberSnapshot(tx, p.old.memberId, {
      trigger: "mutation",
      auditId,
      actorId: actor.id,
      actorEmail: actor.email,
    });
    return { id: next!.id };
  });
}
