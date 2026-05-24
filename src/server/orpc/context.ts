import { auth, type Session } from "~/server/auth/auth";
import { ensureBootstrapAdmin } from "~/server/auth/bootstrap";
import { type DB, db } from "~/server/db/client";
import { startSnapshotScheduler } from "~/server/snapshots/scheduler";

export type AppContext = {
  db: DB;
  session: Session | null;
  headers: Headers;
  requestId: string;
};

let schedulerStarted = false;

export async function createContext(request: Request): Promise<AppContext> {
  await ensureBootstrapAdmin();
  if (!schedulerStarted) {
    schedulerStarted = true;
    try {
      startSnapshotScheduler();
    } catch (err) {
      console.error(`[svuwv] failed to start snapshot scheduler: ${(err as Error).message}`);
    }
  }
  const session = await auth().api.getSession({ headers: request.headers });
  return {
    db: db(),
    session: session ?? null,
    headers: request.headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
