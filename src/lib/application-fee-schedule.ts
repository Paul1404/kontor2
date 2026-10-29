import * as v from "valibot";
import type { AntragsRolle } from "~/server/db/schema/fee-types";
import type { Beitragsstaffel } from "~/server/db/schema/organization-settings";
import type { Altersgrenzen } from "~/server/domain/application/antragstyp";

const Money = v.pipe(v.string(), v.regex(/^\d+(\.\d{1,2})?$/));
const Age = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120));
const Art = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)));
export const ApplicationFeeScheduleInput = v.object({
  effectiveFrom: v.pipe(
    v.string(),
    v.isoDate(),
    v.check(
      (day) => Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day,
      "Ungültiges Gültigkeitsdatum.",
    ),
  ),
  staffel: v.object({
    familie: Money,
    kind: Money,
    kindElternMitglied: Money,
    jugendlich: Money,
    jugendlichElternMitglied: Money,
    jungerErwachsener: Money,
    erwachsener: Money,
  }),
  altersgrenzen: v.pipe(
    v.object({ kindMax: Age, jugendlichMax: Age, jungerErwachsenerMax: Age }),
    v.check(
      (g) => g.kindMax < g.jugendlichMax && g.jugendlichMax < g.jungerErwachsenerMax,
      "Die Altersgrenzen müssen aufsteigend sein.",
    ),
  ),
  feeTypes: v.optional(
    v.object({
      familie: Art,
      kind: Art,
      kind_eltern_mitglied: Art,
      jugendlich: Art,
      jugendlich_eltern_mitglied: Art,
      junger_erwachsener: Art,
      erwachsener: Art,
    }),
  ),
});
export type ApplicationFeeSchedule = v.InferOutput<typeof ApplicationFeeScheduleInput>;
export type ApplicationFeeTypeMap = Partial<Record<AntragsRolle, number>>;

/** Calendar day in the club's timezone, independent of server/browser timezone. */
export function applicationFeeDay(at = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function applicationFeeSettings(
  org: {
    beitragsstaffel: Beitragsstaffel | null;
    kategorieKindMaxAlter: number;
    kategorieJugendlichMaxAlter: number;
    kategorieJungerErwachsenerMaxAlter: number;
    applicationFeeSchedule?: ApplicationFeeSchedule | null;
  },
  at = new Date(),
): {
  staffel: Beitragsstaffel | null;
  altersgrenzen: Altersgrenzen;
  feeTypes?: ApplicationFeeTypeMap;
  scheduled?: boolean;
} {
  const scheduled = org.applicationFeeSchedule;
  if (scheduled && applicationFeeDay(at) >= scheduled.effectiveFrom)
    return { ...scheduled, scheduled: true };
  return {
    staffel: org.beitragsstaffel,
    altersgrenzen: {
      kindMax: org.kategorieKindMaxAlter,
      jugendlichMax: org.kategorieJugendlichMaxAlter,
      jungerErwachsenerMax: org.kategorieJungerErwachsenerMaxAlter,
    },
  };
}

export const APPLICATION_FEE_ROLE_KEYS = {
  familie: "familie",
  kind: "kind",
  kind_eltern_mitglied: "kindElternMitglied",
  jugendlich: "jugendlich",
  jugendlich_eltern_mitglied: "jugendlichElternMitglied",
  junger_erwachsener: "jungerErwachsener",
  erwachsener: "erwachsener",
} as const;
