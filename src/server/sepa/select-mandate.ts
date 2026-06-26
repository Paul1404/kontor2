import type { SepaMandate } from "~/server/db/schema/sepa";

export type MandateSelection = {
  chosen: SepaMandate | null;
  options: SepaMandate[];
  conflict: boolean;
};

/**
 * Pick the mandate to use for a debit. Defaults to the newest active mandate
 * (Status='Aktiv', not revoked, not deleted). If `overrideId` matches one of
 * the active options, it wins -- this lets the Vorstand resolve multi-mandate
 * conflicts from the preview UI.
 *
 * A SEPA Core mandate has no fixed expiry date: it stays valid until revoked
 * and only lapses if it goes 36 months unused. Linear's `gultigBis`
 * ("gültig bis") is therefore deliberately NOT a usability gate -- a mandate is
 * unusable only when deleted, revoked (`widerrufenAm`) or not Aktiv.
 *
 * `conflict = true` when more than one mandate is active; that's the signal
 * to surface the row in the preview's conflict resolver.
 */
export function selectMandate(
  mandates: SepaMandate[],
  overrideId?: string | null,
): MandateSelection {
  const active = mandates
    .filter((m) => {
      if (m.isDeleted) return false;
      if (m.widerrufenAm) return false;
      if (m.status && m.status.toLowerCase() !== "aktiv") return false;
      return true;
    })
    .sort((a, b) => {
      const at = a.angelegtAm?.getTime() ?? 0;
      const bt = b.angelegtAm?.getTime() ?? 0;
      return bt - at;
    });

  if (active.length === 0) {
    return { chosen: null, options: [], conflict: false };
  }

  if (overrideId) {
    const found = active.find((m) => m.id === overrideId);
    if (found) {
      return { chosen: found, options: active, conflict: active.length > 1 };
    }
  }

  return { chosen: active[0]!, options: active, conflict: active.length > 1 };
}

/**
 * FRST for the first ever use of a mandate, RCUR afterwards. Bundesbank
 * requires these in separate `<PmtInf>` blocks within the same pain.008.
 */
export function sequenceTypeFor(mandate: SepaMandate): "FRST" | "RCUR" {
  return mandate.ersteVerwendung ? "RCUR" : "FRST";
}

/**
 * The mandate date for the pain.008 `DtOfSgntr`. There is only one mandate date
 * (Linear's "Datum Sepa-Mandat"); Kontor2 stores it as `unterschriftDatum` and,
 * for imported rows that lacked it, the value lives in `gueltigAb`, with
 * `angelegtAm` as a last resort. We fall back through these real, past dates and
 * NEVER to the collection date: a `DtOfSgntr` in the future is invalid and banks
 * reject it. `angelegtAm` is non-null, so a value is always returned.
 */
export function mandateSignatureDate(mandate: {
  unterschriftDatum: Date | null;
  gueltigAb: Date | null;
  angelegtAm: Date | null;
}): string {
  const d = mandate.unterschriftDatum ?? mandate.gueltigAb ?? mandate.angelegtAm ?? new Date();
  return d.toISOString().slice(0, 10);
}
