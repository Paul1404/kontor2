import { auth, type Session } from "~/server/auth/auth";
import { ensureSessionConfigLoaded } from "~/server/auth/session-config";
import { type DB, db } from "~/server/db/client";
import { installShutdownBridge } from "~/server/lib/lifecycle";
import { registerDbLogSink } from "~/server/lib/log-sink-db";
import { logger } from "~/server/lib/logger";
import { startSnapshotScheduler } from "~/server/snapshots/scheduler";

export type AppContext = {
  db: DB;
  session: Session | null;
  headers: Headers;
  requestId: string;
};

let schedulerStarted = false;

export async function createContext(request: Request): Promise<AppContext> {
  // Start the scheduler before anything that might throw — a transient DB
  // outage during bootstrap shouldn't prevent the nightly snapshot timer
  // from ever being installed.
  if (!schedulerStarted) {
    schedulerStarted = true;
    // Hand the runtime entrypoint a way to release DB/Redis/log resources on
    // shutdown (see src/server/lib/lifecycle.ts). Cheap and synchronous.
    installShutdownBridge();
    // Attach the persistent log sink before the scheduler so any failure it
    // logs is captured in the DB feed too. Both are idempotent and lazy.
    try {
      registerDbLogSink();
    } catch (err) {
      logger.error("failed to register db log sink", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      startSnapshotScheduler();
    } catch (err) {
      logger.error("failed to start snapshot scheduler", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Load the persisted session window before the first `auth()` build so
  // better-auth is configured with the admin-set lifetime, not the defaults.
  await ensureSessionConfigLoaded();
  const session = await auth().api.getSession({ headers: request.headers });
  return {
    db: db(),
    session: session ?? null,
    headers: request.headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
