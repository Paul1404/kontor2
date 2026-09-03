import { ORPCError } from "@orpc/server";
import {
  type CancellationDateMode,
  normalizeTenantPolicy,
  type TenantPolicy,
} from "~/lib/tenant-settings";

/** Subset of organization_settings relevant to the Kündigungsfrist check. */
export type FristSettings = {
  kuendigungsfristAktiv: boolean;
  kuendigungsfristTage: number;
  kuendigungZumMonatsende: boolean;
  tenantPolicy?: TenantPolicy | null;
};

function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCMonth() !== d.getUTCMonth();
}

function isLastDayOfYear(d: Date): boolean {
  return d.getUTCMonth() === 11 && d.getUTCDate() === 31;
}

/** UTC midnight of the given date, dropping any time component. */
function atMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` day into UTC midnight. Throws on anything else. */
function parseDay(day: string): Date {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime())) {
    throw new ORPCError("VALIDATION_FAILED", { message: `Ungültiges Datum: ${day}.` });
  }
  return parsed;
}

/** Notice period in days, or 0 while the Kündigungsfrist feature is off. */
export function resolveNoticeDays(settings: FristSettings | null | undefined): number {
  if (!settings?.kuendigungsfristAktiv) return 0;
  return Math.max(0, settings.kuendigungsfristTage ?? 0);
}

/**
 * The configured Austrittstermin rule.
 *
 * `tenantPolicy.cancellationDateMode` is authoritative and applies on its own:
 * it is a standalone setting ("Zulässiger Austrittstermin"), so a club may
 * allow cancellation only to the year end without also demanding a notice
 * period. The legacy `kuendigungZumMonatsende` boolean is the fallback for
 * tenants that predate the policy object; it stays tied to
 * `kuendigungsfristAktiv` because the settings form nests it under that toggle.
 */
export function resolveCancellationDateMode(
  settings: FristSettings | null | undefined,
): CancellationDateMode {
  if (!settings) return "anytime";
  if (settings.tenantPolicy) {
    return normalizeTenantPolicy(settings.tenantPolicy).cancellationDateMode;
  }
  return settings.kuendigungsfristAktiv && settings.kuendigungZumMonatsende
    ? "month_end"
    : "anytime";
}

/** End of the period `d` falls into, under the given mode. */
function periodEnd(d: Date, mode: CancellationDateMode): Date {
  if (mode === "month_end") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  }
  if (mode === "year_end") {
    return new Date(Date.UTC(d.getUTCFullYear(), 11, 31));
  }
  return d;
}

export type CancellationDatePlan = {
  /** The Austrittstermin the statute produces, `YYYY-MM-DD`. */
  effectiveDate: string;
  /** Earliest date the notice period alone allows, `YYYY-MM-DD`. */
  earliestByNotice: string;
  /**
   * Latest day a written notice may arrive and still take effect on
   * `effectiveDate`. Equals `effectiveDate` when no notice period is set.
   */
  noticeDeadline: string;
  /**
   * The period end the notice just missed, or null when it was in time. With
   * `§ 3 Abs. 2` (Jahresende, 6 Wochen) a notice received on 20.11.2026 misses
   * 31.12.2026 and lands on 31.12.2027, and this holds "2026-12-31".
   */
  missedPeriodEnd: string | null;
  /** The deadline that `missedPeriodEnd` would have needed, or null. */
  missedPeriodDeadline: string | null;
  mode: CancellationDateMode;
  noticeDays: number;
};

/**
 * Derive the Austrittstermin from the day the written Austrittserklärung
 * reached the club, following the configured statute rule.
 *
 * The notice period is counted from the day of receipt, not from the day the
 * office happens to type it in, so a letter that arrived in time keeps its
 * earlier Austrittstermin even when it is recorded weeks later. The result is
 * then rounded forward to the next permitted period end.
 *
 * Example for SV Untereuerheim (§ 3 Abs. 2: Jahresende, 6 Wochen = 42 Tage):
 * receipt on 19.11.2026 gives 31.12.2026, receipt on 20.11.2026 gives
 * 31.12.2027.
 */
export function computeCancellationDate(
  settings: FristSettings | null | undefined,
  noticeReceivedOn: string,
): CancellationDatePlan {
  const mode = resolveCancellationDateMode(settings);
  const noticeDays = resolveNoticeDays(settings);

  const received = parseDay(noticeReceivedOn);
  const earliest = addDays(received, noticeDays);
  const effective = periodEnd(earliest, mode);

  // The period the notice fell into. When the rounded result skips past it,
  // the notice was too late for that period.
  const receivedPeriodEnd = periodEnd(received, mode);
  const missed =
    mode !== "anytime" && receivedPeriodEnd.getTime() < effective.getTime()
      ? isoDay(receivedPeriodEnd)
      : null;

  return {
    effectiveDate: isoDay(effective),
    earliestByNotice: isoDay(earliest),
    noticeDeadline: isoDay(addDays(effective, -noticeDays)),
    missedPeriodEnd: missed,
    missedPeriodDeadline: missed ? isoDay(addDays(receivedPeriodEnd, -noticeDays)) : null,
    mode,
    noticeDays,
  };
}

/**
 * Enforce the configurable cancellation rule. The notice period is measured
 * from `referenceDate`, which is the day the written Austrittserklärung
 * arrived for a recorded cancellation and "now" for an ad-hoc entry. The
 * permitted-date mode (month end / year end) applies independently of the
 * notice period. Throws `ORPCError("VALIDATION_FAILED")` on a violation.
 */
export function assertCancellationAllowed(
  settings: FristSettings | null | undefined,
  effectiveDate: Date,
  referenceDate: Date = new Date(),
): void {
  const eff = atMidnight(effectiveDate);
  const noticeDays = resolveNoticeDays(settings);

  if (noticeDays > 0) {
    const earliest = addDays(atMidnight(referenceDate), noticeDays);
    if (eff < earliest) {
      throw new ORPCError("VALIDATION_FAILED", {
        message: `Kündigungsfrist von ${noticeDays} Tagen nicht eingehalten. Frühester Austrittstermin: ${isoDay(earliest)}.`,
      });
    }
  }

  const mode = resolveCancellationDateMode(settings);
  if (mode === "month_end" && !isLastDayOfMonth(eff)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: "Kündigung ist nur zum Monatsende zulässig.",
    });
  }
  if (mode === "year_end" && !isLastDayOfYear(eff)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: "Kündigung ist nur zum Jahresende zulässig.",
    });
  }
}
