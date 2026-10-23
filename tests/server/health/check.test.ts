import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthcheck } from "~/server/health/check";

afterEach(() => vi.useRealTimers());

describe("readiness", () => {
  it("checks dependencies again after success, outage and recovery", async () => {
    const database = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("private URL"))
      .mockResolvedValueOnce(true);
    const check = createHealthcheck({ db: database, pdf: async () => true });
    expect((await check()).ok).toBe(true);
    expect(await check()).toEqual({ ok: false, checks: { db: false, pdf: true } });
    expect((await check()).ok).toBe(true);
    expect(database).toHaveBeenCalledTimes(3);
  });

  it("bounds stalled probes and coalesces concurrent requests", async () => {
    vi.useFakeTimers();
    const stalled = vi.fn(() => new Promise<boolean>(() => {}));
    const check = createHealthcheck({ redis: stalled, db: async () => true }, 100);
    const first = check();
    expect(check()).toBe(first);
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ ok: false, checks: { redis: false, db: true } });
    expect(stalled).toHaveBeenCalledTimes(1);
  });
});
