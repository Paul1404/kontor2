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
  it("starts at the defaults", () => {
    expect(getSessionConfig()).toEqual(SESSION_DEFAULTS);
  });

  it("reflects a persisted change synchronously", () => {
    setSessionConfigCache({ expiresInDays: 30, updateAgeHours: 6 });
    expect(getSessionConfig()).toEqual({ expiresInDays: 30, updateAgeHours: 6 });
  });

  it("returns a copy so callers cannot mutate the cache in place", () => {
    setSessionConfigCache({ expiresInDays: 30, updateAgeHours: 6 });
    const a = getSessionConfig();
    setSessionConfigCache({ expiresInDays: 60, updateAgeHours: 12 });
    // The earlier reference must not have been mutated by the second write.
    expect(a).toEqual({ expiresInDays: 30, updateAgeHours: 6 });
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
