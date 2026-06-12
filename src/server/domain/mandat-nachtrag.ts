/**
 * Mandate nachtragen: Entscheidungslogik für Lastschrift-Mitglieder ohne
 * nutzbares SEPA-Mandat.
 *
 * Fachliche Grundlage: die Beitrittserklärung des Vereins enthält das
 * SEPA-Lastschriftmandat, d. h. jedes Mitglied hat mit dem Beitritt ein
 * Mandat erteilt. Linear hat diese Mandate teils nie als Datensatz geführt
 * (jahrelang trotzdem eingezogen) oder mit einem künstlichen "Gültig bis"
 * versehen, das nie verlängert wurde, obwohl die Referenz durchgehend in
 * Gebrauch war (SEPA: ein Mandat erlischt erst nach 36 Monaten Nichtnutzung
 * oder durch Widerruf).
 *
 * Daraus folgen drei Fälle:
 * - kein Mandats-Datensatz vorhanden -> Mandat mit Unterschriftsdatum =
 *   Eintrittsdatum nachtragen (`create`),
 * - nur abgelaufene, nie widerrufene Mandate -> das jüngste reaktivieren,
 *   Gültig-bis leeren, Original-Unterschrift bleibt (`reactivate`),
 * - Widerruf vorhanden -> niemals automatisch anfassen (`skip`): ein
 *   widerrufenes Mandat braucht eine neue, echte Unterschrift.
 */

export type MandatLite = {
  id: string;
  isDeleted: boolean;
  widerrufenAm: Date | string | null;
  status: string | null;
  gultigBis: Date | string | null;
  angelegtAm: Date | string | null;
};

export type NachtragPlan =
  | { kind: "create" }
  | { kind: "reactivate"; mandateId: string }
  | { kind: "skip"; reason: string };

function isUsable(m: MandatLite): boolean {
  if (m.isDeleted || m.widerrufenAm != null) return false;
  const status = m.status?.trim().toLowerCase();
  if (status && status !== "aktiv") return false;
  if (m.gultigBis != null && new Date(m.gultigBis) < new Date()) return false;
  return true;
}

export function planMandatNachtrag(opts: {
  eintritt: Date | string | null;
  mandate: MandatLite[];
}): NachtragPlan {
  const live = opts.mandate.filter((m) => !m.isDeleted);

  if (live.some(isUsable)) {
    return { kind: "skip", reason: "Aktives Mandat vorhanden" };
  }
  if (live.some((m) => m.widerrufenAm != null)) {
    return { kind: "skip", reason: "Mandat widerrufen, neue Unterschrift einholen" };
  }

  // Abgelaufen oder inaktiv, aber nie widerrufen: die echte Unterschrift
  // existiert, nur das importierte Gültig-bis ist Datenmüll. Jüngstes
  // reaktivieren statt ein zweites, widersprüchliches Mandat anzulegen.
  const expired = live
    .slice()
    .sort((a, b) => new Date(b.angelegtAm ?? 0).getTime() - new Date(a.angelegtAm ?? 0).getTime());
  if (expired.length > 0) {
    return { kind: "reactivate", mandateId: expired[0]!.id };
  }

  if (opts.eintritt == null) {
    return { kind: "skip", reason: "Kein Eintrittsdatum, Unterschriftsdatum unklar" };
  }
  return { kind: "create" };
}
