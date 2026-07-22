import { describe, expect, it } from "vitest";
import { assertCancellationAllowed } from "~/server/lib/cancellation-frist";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("assertCancellationAllowed", () => {
  const today = utc(2026, 6, 1);

  it("is a no-op when the feature is disabled", () => {
    expect(() =>
      assertCancellationAllowed(
        { kuendigungsfristAktiv: false, kuendigungsfristTage: 90, kuendigungZumMonatsende: true },
        utc(2026, 6, 1),
        today,
      ),
    ).not.toThrow();
  });

  it("is a no-op for null settings", () => {
    expect(() => assertCancellationAllowed(null, utc(2020, 1, 1), today)).not.toThrow();
  });

  it("rejects a date earlier than today + notice days", () => {
    expect(() =>
      assertCancellationAllowed(
        { kuendigungsfristAktiv: true, kuendigungsfristTage: 30, kuendigungZumMonatsende: false },
        utc(2026, 6, 15),
        today,
      ),
    ).toThrow(/Kündigungsfrist/);
  });

  it("accepts a date on or after the earliest allowed date", () => {
    expect(() =>
      assertCancellationAllowed(
        { kuendigungsfristAktiv: true, kuendigungsfristTage: 30, kuendigungZumMonatsende: false },
        utc(2026, 7, 5),
        today,
      ),
    ).not.toThrow();
  });

  it("enforces end-of-month when configured", () => {
    expect(() =>
      assertCancellationAllowed(
        { kuendigungsfristAktiv: true, kuendigungsfristTage: 0, kuendigungZumMonatsende: true },
        utc(2026, 7, 15),
        today,
      ),
    ).toThrow(/Monatsende/);

    expect(() =>
      assertCancellationAllowed(
        { kuendigungsfristAktiv: true, kuendigungsfristTage: 0, kuendigungZumMonatsende: true },
        utc(2026, 7, 31),
        today,
      ),
    ).not.toThrow();
  });

  it("enforces end-of-year from the tenant policy", () => {
    const policy = {
      legacyImportSources: [],
      legacyArchiveEnabled: false,
      cancellationDateMode: "year_end" as const,
      cancellationStatuteReference: null,
      outstandingClaimsStatuteReference: null,
      privacyStatuteReference: null,
      familyPartnerRequired: false,
      familyChildMaxAge: 18,
      departmentPerPersonRequired: false,
      dunningTexts: { level1: null, level2: null, level3: null },
    };
    expect(() =>
      assertCancellationAllowed(
        {
          kuendigungsfristAktiv: true,
          kuendigungsfristTage: 0,
          kuendigungZumMonatsende: false,
          tenantPolicy: policy,
        },
        utc(2026, 12, 30),
        today,
      ),
    ).toThrow(/Jahresende/);
    expect(() =>
      assertCancellationAllowed(
        {
          kuendigungsfristAktiv: true,
          kuendigungsfristTage: 0,
          kuendigungZumMonatsende: false,
          tenantPolicy: policy,
        },
        utc(2026, 12, 31),
        today,
      ),
    ).not.toThrow();
  });
});
