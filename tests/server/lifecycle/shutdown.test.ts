import { describe, expect, it, vi } from "vitest";
import { createShutdownHandler, type ShutdownDeps } from "../../../scripts/shutdown";

function silentLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createShutdownHandler", () => {
  it("drains the server, releases resources, then exits 0", async () => {
    const order: string[] = [];
    const closeResources = vi.fn(async () => {
      order.push("close");
    });
    const stopServer = vi.fn((force: boolean) => {
      order.push(force ? "stop-force" : "stop");
    });
    const exit = vi.fn(() => {
      order.push("exit");
    });

    const shutdown = createShutdownHandler({
      stopServer,
      closeResources,
      log: silentLog(),
      exit,
      drainTimeoutMs: 1_000,
    } as ShutdownDeps);

    await shutdown("SIGTERM");

    expect(order).toEqual(["stop", "close", "exit"]);
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(stopServer).toHaveBeenCalledWith(false);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces connections closed when the drain budget is exceeded", async () => {
    const calls: boolean[] = [];
    // Graceful stop never resolves, so the deadline must trigger a force-close.
    const stopServer = vi.fn((force: boolean) => {
      calls.push(force);
      return force ? Promise.resolve() : new Promise<void>(() => {});
    });
    const exit = vi.fn();
    const log = silentLog();

    const shutdown = createShutdownHandler({
      stopServer,
      closeResources: () => Promise.resolve(),
      log,
      exit,
      drainTimeoutMs: 10,
    });

    await shutdown("SIGTERM");

    expect(calls).toEqual([false, true]);
    expect(log.warn).toHaveBeenCalledWith(
      "drain budget exceeded, forcing connections closed",
      expect.objectContaining({ drainTimeoutMs: 10 }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("runs only once even when invoked from several signals", async () => {
    const stopServer = vi.fn(() => Promise.resolve());
    const closeResources = vi.fn(() => Promise.resolve());
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      stopServer,
      closeResources,
      log: silentLog(),
      exit,
      drainTimeoutMs: 1_000,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    await shutdown("SIGTERM");

    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(closeResources).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits even if resource cleanup is unavailable", async () => {
    const exit = vi.fn();
    const log = silentLog();

    const shutdown = createShutdownHandler({
      stopServer: () => Promise.resolve(),
      // Bridge not installed yet: returns undefined rather than a promise.
      closeResources: () => undefined,
      log,
      exit,
      drainTimeoutMs: 1_000,
    });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs and still exits when resource cleanup rejects", async () => {
    const exit = vi.fn();
    const log = silentLog();

    const shutdown = createShutdownHandler({
      stopServer: () => Promise.resolve(),
      closeResources: () => Promise.reject(new Error("redis down")),
      log,
      exit,
      drainTimeoutMs: 1_000,
    });

    await shutdown("SIGTERM");

    expect(log.error).toHaveBeenCalledWith(
      "resource cleanup failed",
      expect.objectContaining({ error: "redis down" }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not block on a slow graceful stop that eventually resolves", async () => {
    const slow = deferred<void>();
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      stopServer: (force: boolean) => (force ? Promise.resolve() : slow.promise),
      closeResources: () => Promise.resolve(),
      log: silentLog(),
      exit,
      drainTimeoutMs: 1_000,
    });

    const run = shutdown("SIGTERM");
    // Let the graceful stop resolve before the deadline fires.
    slow.resolve();
    await run;

    expect(exit).toHaveBeenCalledWith(0);
  });
});
