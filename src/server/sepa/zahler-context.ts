import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { contractsTable } from "~/server/db/schema/contracts";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { relationshipsTable } from "~/server/db/schema/relationships";

/** Families own both payer and guardian. Imported relationships are evidence only. */
export async function loadZahlerContext(
  db: DB,
  memberIds: string[],
): Promise<{ familieZahlerByMember: Map<string, string>; vertreterByMember: Map<string, string> }> {
  const familieZahlerByMember = new Map<string, string>();
  const vertreterByMember = new Map<string, string>();
  if (!memberIds.length) return { familieZahlerByMember, vertreterByMember };
  const rows = await db
    .select({
      memberId: familienMitgliederTable.memberId,
      zahlerId: familienTable.zahlerMemberId,
      guardianId: familienTable.guardianMemberId,
    })
    .from(familienMitgliederTable)
    .innerJoin(familienTable, eq(familienTable.id, familienMitgliederTable.familieId))
    .where(
      and(
        inArray(familienMitgliederTable.memberId, memberIds),
        isNull(familienMitgliederTable.bis),
      ),
    );
  for (const row of rows) {
    if (!row.zahlerId)
      throw new ORPCError("CONFLICT", {
        message: "Die Familie hat noch keinen Zahler. Bitte zuerst die Familie vervollständigen.",
      });
    familieZahlerByMember.set(row.memberId, row.zahlerId);
    if (row.guardianId) vertreterByMember.set(row.memberId, row.guardianId);
  }
  // A legacy representative must never silently become a self-payer while the migration is unresolved.
  const legacy = await db
    .select({ memberId: relationshipsTable.fromMemberId })
    .from(relationshipsTable)
    .where(
      and(
        inArray(relationshipsTable.fromMemberId, memberIds),
        eq(relationshipsTable.istVertreter, true),
        isNull(relationshipsTable.datBis),
      ),
    );
  for (const row of legacy)
    if (!familieZahlerByMember.has(row.memberId))
      throw new ORPCError("CONFLICT", {
        message: "Familienzuordnung noch ungeklärt. Bitte die Familienübernahme prüfen.",
      });
  const overrides = await db
    .select({ memberId: contractsTable.memberId, payer: contractsTable.zahlerMemberId })
    .from(contractsTable)
    .where(inArray(contractsTable.memberId, memberIds));
  for (const old of overrides)
    if (
      old.payer &&
      old.payer !== old.memberId &&
      familieZahlerByMember.get(old.memberId) !== old.payer
    )
      throw new ORPCError("CONFLICT", {
        message: "Abweichender Vertragszahler muss zuerst in der Familienübernahme geklärt werden.",
      });
  return { familieZahlerByMember, vertreterByMember };
}
