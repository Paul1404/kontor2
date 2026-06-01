import { ORPCError } from "@orpc/server";

/** Subset of organization_settings relevant to the Kündigungsfrist check. */
export type FristSettings = {
  kuendigungsfristAktiv: boolean;
  kuendigungsfristTage: number;
  kuendigungZumMonatsende: boolean;
};

function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCMonth() !== d.getUTCMonth();
}

/** UTC midnight of the given date, dropping any time component. */
function atMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Enforce the configurable cancellation notice period. When the feature is
 * disabled (the default), this is a no-op and any date is accepted. When
 * enabled, the requested effective date must be at least
 * `kuendigungsfristTage` days from `today`, and -- if configured -- fall on the
 * last day of a month. Throws `ORPCError("VALIDATION_FAILED")` otherwise.
 */
export function assertCancellationAllowed(
  settings: FristSettings | null | undefined,
  effectiveDate: Date,
  today: Date = new Date(),
): void {
  if (!settings?.kuendigungsfristAktiv) return;

  const eff = atMidnight(effectiveDate);
  const earliest = atMidnight(today);
  earliest.setUTCDate(earliest.getUTCDate() + (settings.kuendigungsfristTage ?? 0));

  if (eff < earliest) {
    const iso = earliest.toISOString().slice(0, 10);
    throw new ORPCError("VALIDATION_FAILED", {
      message: `Kündigungsfrist von ${settings.kuendigungsfristTage} Tagen nicht eingehalten. Frühester Austrittstermin: ${iso}.`,
    });
  }

  if (settings.kuendigungZumMonatsende && !isLastDayOfMonth(eff)) {
    throw new ORPCError("VALIDATION_FAILED", {
      message: "Kündigung ist nur zum Monatsende zulässig.",
    });
  }
}
