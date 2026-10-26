import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { appendAudit } from "~/server/audit/log";
import type { DBOrTx } from "~/server/db/client";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { takeMemberSnapshot } from "~/server/snapshots/snapshot";

/** Signed child applications join one compatible family, never move existing people. */
export async function assignChildGuardian(
  tx: DBOrTx,
  childId: string,
  guardianId: string,
  name: string,
  actor: { id: string; email: string },
) {
  if (childId === guardianId)
    throw new ORPCError("CONFLICT", {
      message: "Kind und Sorgeberechtigter müssen verschiedene Personen sein.",
    });
  const rows = await tx
    .select()
    .from(familienMitgliederTable)
    .where(
      and(
        inArray(familienMitgliederTable.memberId, [childId, guardianId]),
        isNull(familienMitgliederTable.bis),
      ),
    );
  const familyIds = [...new Set(rows.map((r) => r.familieId))];
  if (familyIds.length > 1)
    throw new ORPCError("CONFLICT", {
      message: "Kind und Sorgeberechtigter gehören zu verschiedenen Familien.",
    });
  let id = familyIds[0];
  if (id) {
    const [family] = await tx.select().from(familienTable).where(eq(familienTable.id, id));
    if (
      (family!.guardianMemberId && family!.guardianMemberId !== guardianId) ||
      (family!.zahlerMemberId && family!.zahlerMemberId !== guardianId)
    )
      throw new ORPCError("CONFLICT", {
        message: "Familie hat einen anderen Zahler oder Sorgeberechtigten. Bitte zuerst klären.",
      });
    await tx
      .update(familienTable)
      .set({ zahlerMemberId: guardianId, guardianMemberId: guardianId, updatedAt: new Date() })
      .where(eq(familienTable.id, id));
  } else {
    const [family] = await tx
      .insert(familienTable)
      .values({ name, zahlerMemberId: guardianId, guardianMemberId: guardianId })
      .returning({ id: familienTable.id });
    id = family!.id;
  }
  for (const person of [
    { id: childId, role: "kind" as const },
    { id: guardianId, role: "zahler" as const },
  ]) {
    const old = rows.find((r) => r.memberId === person.id);
    if (old) {
      if (person.id === childId && old.rolle !== "kind")
        throw new ORPCError("CONFLICT", {
          message: "Familienrolle des Kindes widerspricht dem Antrag.",
        });
      if (person.id === guardianId) {
        if (old.rolle === "kind")
          throw new ORPCError("CONFLICT", {
            message: "Sorgeberechtigter ist als Kind zugeordnet.",
          });
        await tx
          .update(familienMitgliederTable)
          .set({ isGuardian: true })
          .where(eq(familienMitgliederTable.id, old.id));
      }
    } else
      await tx.insert(familienMitgliederTable).values({
        familieId: id,
        memberId: person.id,
        rolle: person.role,
        isGuardian: person.id === guardianId,
      });
  }
  const auditId = await appendAudit(tx, {
    entityType: "familie",
    entityId: id,
    action: "update",
    source: "ui",
    actorId: actor.id,
    actorEmail: actor.email,
    changes: {
      guardian: { before: null, after: guardianId },
      child: { before: null, after: childId },
    },
  });
  const all = await tx
    .select({ memberId: familienMitgliederTable.memberId })
    .from(familienMitgliederTable)
    .where(eq(familienMitgliederTable.familieId, id));
  for (const person of all)
    await takeMemberSnapshot(tx, person.memberId, {
      trigger: "mutation",
      auditId,
      actorId: actor.id,
      actorEmail: actor.email,
    });
}
