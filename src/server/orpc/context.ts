import { auth, type Session } from "~/server/auth/auth";
import { ensureBootstrapAdmin } from "~/server/auth/bootstrap";
import { ensureSessionConfigLoaded } from "~/server/auth/session-config";
import { type DB, db } from "~/server/db/client";
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
  await ensureBootstrapAdmin();
  const session = await auth().api.getSession({ headers: request.headers });
  return {
    db: db(),
    session: session ?? null,
    headers: request.headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
