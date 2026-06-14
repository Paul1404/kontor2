/**
 * Resolve the annual fee for an online membership application, preferring the
 * Beitragsart tagged for the application's role and quoting its `betrag1`, so
 * the Beitragsart is the single source of the price and the applicant is quoted
 * the exact Beitragsart they will be assigned. Falls back to the club's
 * Beitragsstaffel while no matching Beitragsart is tagged, so existing clubs are
 * unaffected until they opt in. Throws when neither is configured.
 */

import { ORPCError } from "@orpc/server";
import { and, asc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { DBOrTx } from "~/server/db/client";
import { feeTypesTable } from "~/server/db/schema/fee-types";
import type { Beitragsstaffel } from "~/server/db/schema/organization-settings";
import type { AntragKategorie } from "~/server/domain/application/antragstyp";
import { antragsRolleFor, calculateFee } from "~/server/domain/application/fees";

export type ResolvedFee = {
  betrag: string;
  label: string;
  /** The matched Beitragsart, or null when the quote came from the Staffel. */
  art: number | null;
};

/** Trim a numeric(19,8) DB decimal to a 2-decimal euro string for display. */
function euro2(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

export async function resolveApplicationFee(
  db: DBOrTx,
  opts: {
    kategorie: AntragKategorie;
    elternteilMitglied: boolean;
    staffel: Beitragsstaffel | null;
  },
): Promise<ResolvedFee> {
  const rolle = antragsRolleFor(opts.kategorie, opts.elternteilMitglied);
  const [tagged] = await db
    .select({
      art: feeTypesTable.art,
      bezeichnung: feeTypesTable.bezeichnung,
      betrag1: feeTypesTable.betrag1,
    })
    .from(feeTypesTable)
    .where(
      and(
        eq(feeTypesTable.antragsRolle, rolle),
        isNotNull(feeTypesTable.betrag1),
        // nichAktiv is the legacy "deactivated" flag; null means active.
        or(isNull(feeTypesTable.nichAktiv), ne(feeTypesTable.nichAktiv, "J")),
      ),
    )
    .orderBy(asc(feeTypesTable.art))
    .limit(1);

  if (tagged?.betrag1 != null) {
    return {
      betrag: euro2(tagged.betrag1),
      label: tagged.bezeichnung ?? `Beitragsart ${tagged.art}`,
      art: tagged.art,
    };
  }

  // No tagged Beitragsart for this role: fall back to the Staffel (existing
  // behaviour) so a club that has not migrated keeps its current quotes.
  if (opts.staffel) {
    const f = calculateFee({
      kategorie: opts.kategorie,
      elternteilMitglied: opts.elternteilMitglied,
      staffel: opts.staffel,
    });
    return { betrag: f.betrag, label: f.label, art: null };
  }

  throw new ORPCError("PRECONDITION_FAILED", {
    message:
      "Für diese Kategorie ist kein Beitrag hinterlegt. Bitte eine Beitragsart für den Online-Antrag zuordnen oder die Beitragsstaffel pflegen.",
  });
}
