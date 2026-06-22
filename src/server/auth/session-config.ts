import type { DB } from "~/server/db/client";
import { authSettingsTable } from "~/server/db/schema/settings";
import { logger } from "~/server/lib/logger";

/**
 * Admin-tunable session timing for better-auth. The numbers live in the
 * `auth_settings` table and are mirrored into this in-memory cache so
 * `buildAuth()` (in `auth.ts`) can read them synchronously. When an admin
 * changes them, the procedure updates this cache and drops the memoized auth
 * instance (`invalidateAuth`), so the next request rebuilds better-auth with
 * the new window. No redeploy needed.
 */
export type SessionConfig = {
  /** Session lifetime in days -> better-auth `session.expiresIn`. */
  expiresInDays: number;
  /** Sliding-refresh interval in hours -> better-auth `session.updateAge`. */
  updateAgeHours: number;
};

export const SESSION_DEFAULTS: SessionConfig = {
  expiresInDays: 90,
  updateAgeHours: 24,
};

/** Accepted input ranges, shared by the Valibot schema and the UI. */
export const SESSION_LIMITS = {
  expiresInDays: { min: 1, max: 365 },
  updateAgeHours: { min: 1, max: 24 * 30 },
} as const;

type Entry = {
  config: SessionConfig;
  loaded: boolean;
  loading?: Promise<void>;
};

const entries = new Map<string, Entry>();

function entryFor(tenantKey: string): Entry {
  let entry = entries.get(tenantKey);
  if (!entry) {
    entry = {
      config: { ...SESSION_DEFAULTS },
      loaded: false,
    };
    entries.set(tenantKey, entry);
  }
  return entry;
}

/** Synchronous read of the active config. Used by `buildAuth()`. */
export function getSessionConfig(tenantKey: string): SessionConfig {
  return entries.get(tenantKey)?.config ?? { ...SESSION_DEFAULTS };
}

/** Overwrite the cache after a persisted change so it applies immediately. */
export function setSessionConfigCache(tenantKey: string, next: SessionConfig): void {
  const entry = entryFor(tenantKey);
  entry.config = { ...next };
  entry.loaded = true;
}

async function load(tenantKey: string, tenantDb: DB): Promise<void> {
  const entry = entryFor(tenantKey);
  try {
    const [row] = await tenantDb.select().from(authSettingsTable).limit(1);
    if (row) {
      entry.config = {
        expiresInDays: row.sessionExpiresInDays,
        updateAgeHours: row.sessionUpdateAgeHours,
      };
    }
    entry.loaded = true;
  } catch (err) {
    // The table may not exist yet (first boot before migrations) or the DB
    // may be briefly unreachable. Keep the defaults and let a later request
    // retry rather than failing auth bootstrap.
    logger.warn("session config load failed, using defaults", {
      tenantKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Populate the cache from the DB once per process. Callers must await this
 * before the first use of `auth()` so better-auth is built with the persisted
 * window rather than the defaults.
 */
export async function ensureSessionConfigLoaded(tenantKey: string, tenantDb: DB): Promise<void> {
  const entry = entryFor(tenantKey);
  if (entry.loaded) return;
  if (!entry.loading) {
    entry.loading = load(tenantKey, tenantDb).finally(() => {
      entry.loading = undefined;
    });
  }
  return entry.loading;
}

/** Test-only: reset the module cache so a fresh load can be exercised. */
export function _resetSessionConfigCache(): void {
  entries.clear();
}
