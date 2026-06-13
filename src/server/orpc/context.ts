import { auth, type Session } from "~/server/auth/auth";
import { ensureSessionConfigLoaded } from "~/server/auth/session-config";
import { type DB, dbForTenant } from "~/server/db/client";
import { installShutdownBridge } from "~/server/lib/lifecycle";
import { registerDbLogSink } from "~/server/lib/log-sink-db";
import { logger } from "~/server/lib/logger";
import { startSnapshotScheduler } from "~/server/snapshots/scheduler";
import type { Tenant } from "~/server/tenants/registry";
import { resolveTenantFromHost } from "~/server/tenants/resolve";

export type AppContext = {
  db: DB;
  /** The Verein this request belongs to, resolved from the request host. */
  tenant: Tenant;
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
  // Resolve the Verein from the request host (e.g. svu.kontor2.com -> "svu").
  // The reverse proxy forwards the original host; fall back to `host`. With a
  // single tenant this always resolves to the primary, so `context.db` is
  // unchanged. NOTE: auth() is still a single instance (the primary's); making
  // it per-tenant is Stage 2.
  const tenant = resolveTenantFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  const session = await auth(tenant).api.getSession({ headers: request.headers });
  return {
    db: dbForTenant(tenant.databaseUrl),
    tenant,
    session: session ?? null,
    headers: request.headers,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
  };
}
