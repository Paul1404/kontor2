import { describe, expect, it } from "vitest";
import type { TenantPolicy } from "~/lib/tenant-settings";
import {
  computeCancellationDate,
  type FristSettings,
  resolveCancellationDateMode,
} from "~/server/lib/cancellation-frist";

function policy(overrides: Partial<TenantPolicy> = {}): TenantPolicy {
  return {
    legacyImportSources: [],
    legacyArchiveEnabled: false,
    cancellationDateMode: "anytime",
    cancellationStatuteReference: null,
    outstandingClaimsStatuteReference: null,
    privacyStatuteReference: null,
    familyPartnerRequired: false,
    familyChildMaxAge: 18,
    departmentPerPersonRequired: false,
    dunningTexts: { level1: null, level2: null, level3: null },
    ...overrides,
  };
}

/**
 * SV Untereuerheim, § 3 Abs. 2: "Der Austritt ist nur zum Schluss eines
 * Kalenderjahres unter Einhaltung einer Frist von 6 Wochen zulässig."
 */
const satzung: FristSettings = {
  kuendigungsfristAktiv: true,
  kuendigungsfristTage: 42,
  kuendigungZumMonatsende: false,
  tenantPolicy: policy({
    cancellationDateMode: "year_end",
    cancellationStatuteReference: "§ 3 Abs. 2",
  }),
};

describe("computeCancellationDate: Jahresende mit 6 Wochen Frist", () => {
  it("keeps the current year end when the notice arrives exactly on the deadline", () => {
    const plan = computeCancellationDate(satzung, "2026-11-19");
    expect(plan.effectiveDate).toBe("2026-12-31");
    expect(plan.noticeDeadline).toBe("2026-11-19");
    expect(plan.missedPeriodEnd).toBeNull();
  });

  it("rolls to the next year end one day after the deadline", () => {
    const plan = computeCancellationDate(satzung, "2026-11-20");
    expect(plan.effectiveDate).toBe("2027-12-31");
    expect(plan.missedPeriodEnd).toBe("2026-12-31");
    expect(plan.missedPeriodDeadline).toBe("2026-11-19");
    expect(plan.noticeDeadline).toBe("2027-11-19");
  });

  it("keeps the current year end for a notice received early in the year", () => {
    const plan = computeCancellationDate(satzung, "2026-01-02");
    expect(plan.effectiveDate).toBe("2026-12-31");
    expect(plan.missedPeriodEnd).toBeNull();
  });

  it("handles a notice received in the last days of December", () => {
    const plan = computeCancellationDate(satzung, "2026-12-28");
    expect(plan.earliestByNotice).toBe("2027-02-08");
    expect(plan.effectiveDate).toBe("2027-12-31");
    expect(plan.missedPeriodEnd).toBe("2026-12-31");
  });

  it("reports the rule it applied", () => {
    const plan = computeCancellationDate(satzung, "2026-03-01");
    expect(plan.mode).toBe("year_end");
    expect(plan.noticeDays).toBe(42);
  });

  it("crosses a leap day correctly", () => {
    // 2028 is a leap year; 42 days from 2028-01-20 is 2028-03-02.
    const plan = computeCancellationDate(satzung, "2028-01-20");
    expect(plan.earliestByNotice).toBe("2028-03-02");
    expect(plan.effectiveDate).toBe("2028-12-31");
  });
});

describe("computeCancellationDate: other configurations", () => {
  const monthEnd: FristSettings = {
    kuendigungsfristAktiv: true,
    kuendigungsfristTage: 30,
    kuendigungZumMonatsende: true,
    tenantPolicy: policy({ cancellationDateMode: "month_end" }),
  };

  it("rounds forward to the end of the month the notice period lands in", () => {
    const plan = computeCancellationDate(monthEnd, "2026-01-15");
    expect(plan.earliestByNotice).toBe("2026-02-14");
    expect(plan.effectiveDate).toBe("2026-02-28");
    expect(plan.missedPeriodEnd).toBe("2026-01-31");
    expect(plan.missedPeriodDeadline).toBe("2026-01-01");
  });

  it("returns the receipt date itself when nothing is configured", () => {
    const plan = computeCancellationDate(
      { kuendigungsfristAktiv: false, kuendigungsfristTage: 0, kuendigungZumMonatsende: false },
      "2026-05-04",
    );
    expect(plan.effectiveDate).toBe("2026-05-04");
    expect(plan.noticeDays).toBe(0);
    expect(plan.mode).toBe("anytime");
    expect(plan.missedPeriodEnd).toBeNull();
  });

  it("applies a notice period without a date mode", () => {
    const plan = computeCancellationDate(
      { kuendigungsfristAktiv: true, kuendigungsfristTage: 14, kuendigungZumMonatsende: false },
      "2026-05-04",
    );
    expect(plan.effectiveDate).toBe("2026-05-18");
    expect(plan.noticeDeadline).toBe("2026-05-04");
  });

  it("treats null settings as unrestricted", () => {
    expect(computeCancellationDate(null, "2026-05-04").effectiveDate).toBe("2026-05-04");
  });
});

describe("resolveCancellationDateMode", () => {
  it("uses the tenant policy even when the notice period is off", () => {
    expect(
      resolveCancellationDateMode({
        kuendigungsfristAktiv: false,
        kuendigungsfristTage: 0,
        kuendigungZumMonatsende: false,
        tenantPolicy: policy({ cancellationDateMode: "year_end" }),
      }),
    ).toBe("year_end");
  });

  it("keeps the legacy boolean tied to the notice-period toggle", () => {
    expect(
      resolveCancellationDateMode({
        kuendigungsfristAktiv: false,
        kuendigungsfristTage: 0,
        kuendigungZumMonatsende: true,
      }),
    ).toBe("anytime");
    expect(
      resolveCancellationDateMode({
        kuendigungsfristAktiv: true,
        kuendigungsfristTage: 0,
        kuendigungZumMonatsende: true,
      }),
    ).toBe("month_end");
  });
});
