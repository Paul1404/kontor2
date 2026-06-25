import { afterEach, describe, expect, it } from "vitest";
import {
  _resetSessionConfigCache,
  getSessionConfig,
  SESSION_DEFAULTS,
  SESSION_LIMITS,
  setSessionConfigCache,
} from "~/server/auth/session-config";

afterEach(() => {
  _resetSessionConfigCache();
});

describe("session config cache", () => {
  it("returns defaults for an unseen tenant key", () => {
    expect(getSessionConfig("tenant-a")).toEqual(SESSION_DEFAULTS);
  });

  it("reflects a persisted tenant change synchronously", () => {
    setSessionConfigCache("tenant-a", { expiresInDays: 30, updateAgeHours: 6 });
    expect(getSessionConfig("tenant-a")).toEqual({ expiresInDays: 30, updateAgeHours: 6 });
  });

  it("does not leak settings between tenants", () => {
    setSessionConfigCache("tenant-a", { expiresInDays: 30, updateAgeHours: 6 });

    expect(getSessionConfig("tenant-a")).toEqual({ expiresInDays: 30, updateAgeHours: 6 });
    expect(getSessionConfig("tenant-b")).toEqual(SESSION_DEFAULTS);
  });

  it("does not mutate one tenant's returned config when another tenant changes", () => {
    setSessionConfigCache("tenant-a", { expiresInDays: 30, updateAgeHours: 6 });
    const a = getSessionConfig("tenant-a");

    setSessionConfigCache("tenant-b", { expiresInDays: 60, updateAgeHours: 12 });

    expect(a).toEqual({ expiresInDays: 30, updateAgeHours: 6 });
    expect(getSessionConfig("tenant-b")).toEqual({ expiresInDays: 60, updateAgeHours: 12 });
  });

  it("clears all tenant entries on reset", () => {
    setSessionConfigCache("tenant-a", { expiresInDays: 30, updateAgeHours: 6 });
    setSessionConfigCache("tenant-b", { expiresInDays: 60, updateAgeHours: 12 });

    _resetSessionConfigCache();

    expect(getSessionConfig("tenant-a")).toEqual(SESSION_DEFAULTS);
    expect(getSessionConfig("tenant-b")).toEqual(SESSION_DEFAULTS);
  });

  it("exposes sane default limits", () => {
    expect(SESSION_LIMITS.expiresInDays.min).toBeLessThanOrEqual(SESSION_DEFAULTS.expiresInDays);
    expect(SESSION_LIMITS.expiresInDays.max).toBeGreaterThanOrEqual(SESSION_DEFAULTS.expiresInDays);
    expect(SESSION_LIMITS.updateAgeHours.min).toBeLessThanOrEqual(SESSION_DEFAULTS.updateAgeHours);
    expect(SESSION_LIMITS.updateAgeHours.max).toBeGreaterThanOrEqual(
      SESSION_DEFAULTS.updateAgeHours,
    );
  });
});
