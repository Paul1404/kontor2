/**
 * Process-wide resource teardown for graceful shutdown.
 *
 * The runtime entrypoint (`scripts/serve.ts`) ships in the slim production
 * container and can't import `~/server/*`, so it can't close the DB pool, the
 * Redis client, or drain the buffered log sink directly. Instead the server
 * bundle installs `closeResources` on `globalThis.__svuwvCloseResources` (see
 * `src/server/orpc/context.ts`), and `serve.ts` calls it across the bundle
 * boundary after it has drained in-flight HTTP requests.
 */

import { closeDb } from "~/server/db/client";
import { flushSinks, logger } from "~/server/lib/logger";
import { closeRedis } from "~/server/redis/client";
import { stopSnapshotScheduler } from "~/server/snapshots/scheduler";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let inFlight: Promise<void> | undefined;

/**
 * Release every resource the process holds, in dependency order: stop the
 * snapshot timer, flush buffered log sinks (the DB sink writes through the
 * pool, so it must drain first), then close the Postgres pool and Redis
 * client. Failures are logged, never thrown — shutdown must always run to
 * completion. Idempotent: concurrent or repeated calls share a single run.
 */
export function closeResources(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    stopSnapshotScheduler();

    try {
      await flushSinks();
    } catch (err) {
      logger.error("log flush on shutdown failed", { error: message(err) });
    }

    const results = await Promise.allSettled([closeDb(), closeRedis()]);
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("resource close on shutdown failed", { error: message(result.reason) });
      }
    }
  })();
  return inFlight;
}

/**
 * Expose `closeResources` to the runtime entrypoint across the build boundary.
 * Idempotent; called from the one-time oRPC context init so it runs shortly
 * after boot (the warmup self-request guarantees `createContext` executes).
 */
export function installShutdownBridge(): void {
  globalThis.__svuwvCloseResources = closeResources;
}
