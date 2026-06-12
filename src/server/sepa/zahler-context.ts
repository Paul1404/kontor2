import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "~/server/db/client";
import { familienMitgliederTable, familienTable } from "~/server/db/schema/familien";
import { relationshipsTable } from "~/server/db/schema/relationships";

/**
 * Laedt die Zahler-Aufloesungsdaten fuer eine Menge von Mitgliedern in zwei
 * Bulk-Queries: den Familien-Zahler je aktivem Kind und das Ziel der
 * Beziehung mit Vertreter-Flag. Gemeinsame Grundlage fuer den Beitragslauf
 * und das Mandate-Nachtragen, damit beide identisch aufloesen.
 */
export async function loadZahlerContext(
  db: DB,
  memberIds: string[],
): Promise<{
  familieZahlerByMember: Map<string, string>;
  vertreterByMember: Map<string, string>;
}> {
  const familieZahlerByMember = new Map<string, string>();
  const vertreterByMember = new Map<string, string>();
  if (memberIds.length === 0) return { familieZahlerByMember, vertreterByMember };

  const kinder = await db
    .select({
      memberId: familienMitgliederTable.memberId,
      zahlerId: familienTable.zahlerMemberId,
    })
    .from(familienMitgliederTable)
    .innerJoin(familienTable, eq(familienTable.id, familienMitgliederTable.familieId))
    .where(
      and(
        inArray(familienMitgliederTable.memberId, memberIds),
        isNull(familienMitgliederTable.bis),
        eq(familienMitgliederTable.rolle, "kind"),
      ),
    );
  for (const k of kinder) {
    if (k.zahlerId) familieZahlerByMember.set(k.memberId, k.zahlerId);
  }

  const vertreter = await db
    .select({
      fromMemberId: relationshipsTable.fromMemberId,
      toMemberId: relationshipsTable.toMemberId,
    })
    .from(relationshipsTable)
    .where(
      and(
        inArray(relationshipsTable.fromMemberId, memberIds),
        eq(relationshipsTable.istVertreter, true),
      ),
    );
  for (const v of vertreter) {
    if (v.toMemberId) vertreterByMember.set(v.fromMemberId, v.toMemberId);
  }

  return { familieZahlerByMember, vertreterByMember };
}
