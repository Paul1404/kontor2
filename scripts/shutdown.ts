/**
 * Graceful-shutdown sequencing for the runtime entrypoint.
 *
 * Split out from `serve.ts` so the ordering (drain in-flight HTTP, then release
 * app resources, then exit) is unit-testable without booting a real server.
 * Self-contained: no `~/` imports, so it runs in the slim production container
 * alongside `serve.ts`.
 */

type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type ShutdownDeps = {
  /** Stop the HTTP server. `force` closes active connections immediately. */
  stopServer: (force: boolean) => Promise<unknown> | unknown;
  /**
   * Release app-held resources (DB, Redis, log buffers). Returns `undefined`
   * if the server bundle hasn't installed the bridge yet (e.g. SIGTERM before
   * the first request).
   */
  closeResources: () => Promise<void> | undefined;
  log: Logger;
  exit: (code: number) => void;
  /** Time to wait for in-flight requests before forcing connections closed. */
  drainTimeoutMs?: number;
};

const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build a one-shot shutdown handler. The returned function is safe to attach
 * to multiple signals: the first invocation runs the sequence, later ones are
 * ignored so a SIGINT after a SIGTERM can't tear down twice.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;

    const budget = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    deps.log.info("graceful shutdown started", { signal, drainTimeoutMs: budget });

    await drainServer(deps, budget);

    try {
      await deps.closeResources();
    } catch (err) {
      deps.log.error("resource cleanup failed", { error: errorMessage(err) });
    }

    deps.log.info("graceful shutdown complete", { signal });
    deps.exit(0);
  };
}

/**
 * Stop accepting new connections and wait for in-flight requests to finish. If
 * they don't drain within the budget, force the remaining connections closed
 * so the container can exit before the platform's hard kill.
 */
async function drainServer(deps: ShutdownDeps, budget: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budget);
  });
  try {
    const drained = Promise.resolve(deps.stopServer(false)).then(() => "drained" as const);
    const outcome = await Promise.race([drained, timedOut]);
    if (outcome === "timeout") {
      deps.log.warn("drain budget exceeded, forcing connections closed", {
        drainTimeoutMs: budget,
      });
      await Promise.resolve(deps.stopServer(true));
    }
  } catch (err) {
    deps.log.warn("server drain failed", { error: errorMessage(err) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
