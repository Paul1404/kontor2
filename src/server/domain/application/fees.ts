/**
 * Annual-fee resolution for the online membership application. The schedule
 * (Beitragsstaffel) is configured per club in `organization_settings`; this
 * module is the pure mapping from age category + parent-member flag to the
 * amount and a German label. Ported from svums `services/fees.py`.
 */

import {
  type Beitragsstaffel,
  DEFAULT_BEITRAGSSTAFFEL,
} from "~/server/db/schema/organization-settings";
import type { AntragKategorie } from "~/server/domain/application/antragstyp";

export { DEFAULT_BEITRAGSSTAFFEL };

export type FeeResult = { betrag: string; label: string };

/**
 * Resolve the annual fee for a category. `elternteilMitglied` only affects the
 * `kind` and `jugendlich` categories (a discounted rate when a parent is
 * already a member); the other categories ignore it.
 */
export function calculateFee(opts: {
  kategorie: AntragKategorie;
  elternteilMitglied: boolean;
  staffel?: Beitragsstaffel | null;
}): FeeResult {
  const s = opts.staffel ?? DEFAULT_BEITRAGSSTAFFEL;
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
