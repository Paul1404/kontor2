/**
 * Annual-fee resolution for the online membership application. The schedule
 * (Beitragsstaffel) is configured per club in `organization_settings`; this
 * module is the pure mapping from age category + parent-member flag to the
 * amount and a German label. Ported from svums `services/fees.py`.
 */

import type { AntragsRolle } from "~/server/db/schema/fee-types";
import {
  type Beitragsstaffel,
  DEFAULT_BEITRAGSSTAFFEL,
} from "~/server/db/schema/organization-settings";
import type { AntragKategorie } from "~/server/domain/application/antragstyp";

export { DEFAULT_BEITRAGSSTAFFEL };

/**
 * Map an application case (age category + parent-member flag) to the
 * online-application role a Beitragsart can be tagged with. The parent-member
 * discount only splits `kind` and `jugendlich`; the other categories have a
 * single role.
 */
export function antragsRolleFor(
  kategorie: AntragKategorie,
  elternteilMitglied: boolean,
): AntragsRolle {
  switch (kategorie) {
    case "familie":
      return "familie";
    case "kind":
      return elternteilMitglied ? "kind_eltern_mitglied" : "kind";
    case "jugendlich":
      return elternteilMitglied ? "jugendlich_eltern_mitglied" : "jugendlich";
    case "junger_erwachsener":
      return "junger_erwachsener";
    case "erwachsener":
      return "erwachsener";
  }
}

export type FeeResult = { betrag: string; label: string };

/**
 * Resolve the annual fee for a category. `elternteilMitglied` only affects the
 * `kind` and `jugendlich` categories (a discounted rate when a parent is
 * already a member); the other categories ignore it.
 *
 * `staffel` is required: the caller must pass the club's configured schedule.
 * There is deliberately no fallback to a hardcoded schedule, so a club that has
 * not configured its Beitragsstaffel never silently bills another club's prices
 * (callers refuse with a clear error instead).
 */
export function calculateFee(opts: {
  kategorie: AntragKategorie;
  elternteilMitglied: boolean;
  staffel: Beitragsstaffel;
}): FeeResult {
  const s = opts.staffel;
  switch (opts.kategorie) {
    case "familie":
      return { betrag: s.familie, label: "Familie (2 Erwachsene + Kinder bis 18 Jahre)" };
    case "kind":
      return opts.elternteilMitglied
        ? { betrag: s.kindElternMitglied, label: "Kinder (bis 14 Jahre), 1 Elternteil Mitglied" }
        : { betrag: s.kind, label: "Kinder (bis 14 Jahre), kein Elternteil Mitglied" };
    case "jugendlich":
      return opts.elternteilMitglied
        ? {
            betrag: s.jugendlichElternMitglied,
            label: "Jugendliche (bis 18 Jahre), 1 Elternteil Mitglied",
          }
        : { betrag: s.jugendlich, label: "Jugendliche (bis 18 Jahre), kein Elternteil Mitglied" };
    case "junger_erwachsener":
      return { betrag: s.jungerErwachsener, label: "Junge Erwachsene (bis 25 Jahre)" };
    case "erwachsener":
      return { betrag: s.erwachsener, label: "Erwachsene" };
  }
}
