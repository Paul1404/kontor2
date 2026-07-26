import { describe, expect, it, vi } from "vitest";
import { type DailyGateStore, runPersistedDailyGate } from "~/server/lfio/daily-gate";

function memoryStore(): DailyGateStore {
  const values = new Map<string, string>();
  return {
    async reserve(key) {
      if (values.has(key)) return false;
      values.set(key, "reserved");
      return true;
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
}

describe("persisted daily gate", () => {
  it("collects once per UTC day and reuses the persisted result", async () => {
    const store = memoryStore();
    const collect = vi.fn(async () => ({ count: 12 }));
    const opts = {
      namespace: "lfio:s3-inventory",
      store,
      collect,
      now: new Date("2026-07-26T10:00:00Z"),
    };

    await expect(runPersistedDailyGate(opts)).resolves.toEqual({
      status: "fresh",
      value: { count: 12 },
    });
    await expect(runPersistedDailyGate(opts)).resolves.toEqual({
      status: "cached",
      value: { count: 12 },
    });
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the persistent gate is unavailable", async () => {
    const collect = vi.fn(async () => ({ count: 12 }));
    const store: DailyGateStore = {
      reserve: async () => {
        throw new Error("redis unavailable");
      },
      get: async () => null,
      put: async () => {},
    };

    await expect(
      runPersistedDailyGate({ namespace: "lfio:s3-inventory", store, collect }),
    ).resolves.toEqual({ status: "gate_error", error: "redis unavailable" });
    expect(collect).not.toHaveBeenCalled();
  });

  it("does not retry a failed billable collection during the same day", async () => {
    const store = memoryStore();
    const collect = vi.fn(async () => {
      throw new Error("listing timed out");
    });
    const opts = {
      namespace: "lfio:s3-inventory",
      store,
      collect,
      now: new Date("2026-07-26T10:00:00Z"),
    };

    await expect(runPersistedDailyGate(opts)).resolves.toEqual({
      status: "collect_error",
      error: "listing timed out",
    });
    await expect(runPersistedDailyGate(opts)).resolves.toEqual({
      status: "cached",
      value: null,
    });
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("allows a new collection on the next UTC day", async () => {
    const store = memoryStore();
    const collect = vi.fn(async () => ({ count: 12 }));
    const base = { namespace: "lfio:s3-inventory", store, collect };

    await runPersistedDailyGate({ ...base, now: new Date("2026-07-26T23:59:00Z") });
    await runPersistedDailyGate({ ...base, now: new Date("2026-07-27T00:01:00Z") });
    expect(collect).toHaveBeenCalledTimes(2);
  });
});
