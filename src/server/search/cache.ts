import { createHash } from "node:crypto";
import { redis } from "~/server/redis/client";

/**
 * Tenant-scoped Redis cache.
 *
 * The Redis connection is process-wide and shared by every Verein, so every
 * cache key for tenant-specific data MUST carry the tenant key as its first
 * segment. Without it two Vereine that issue the same query collide on one key
 * and one is served the other's data (members, dashboard KPIs, fee types).
 * This mirrors the `auth:${tenant.key}:` scheme the auth layer already uses.
 *
 * Keys look like `kontor2:t:<tenantKey>:<namespace>:<key>`, so a whole
 * namespace for one tenant can be invalidated with a SCAN+DEL that never
 * touches another tenant.
 */
const ROOT = "kontor2:t";

/** Namespaces (the middle segment). Keep them disjoint. */
export const CACHE_NS = {
  dashboard: "dashboard",
  abteilungen: "abteilungen",
  feeTypes: "feetypes",
} as const;

const SEARCH_NS = "members:search";
const DEFAULT_TTL_SECONDS = 300;

/** `kontor2:t:<tenantKey>:<namespace>:` -- the prefix for one tenant+namespace. */
function nsPrefix(tenantKey: string, namespace: string): string {
  return `${ROOT}:${tenantKey}:${namespace}:`;
}

export function searchCacheKey(tenantKey: string, query: unknown): string {
  const h = createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 24);
  return `${nsPrefix(tenantKey, SEARCH_NS)}${h}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCached(
  key: string,
  value: unknown,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    await redis().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    /* cache miss is non-fatal */
  }
}

/**
 * Read-through cache scoped to one tenant: return the cached value for
 * `<tenant>:<namespace>:<key>`, or run `loader`, cache its result, and return
 * it. Always falls back to `loader` when Redis is unavailable, so caching can
 * never take the feature down.
 *
 * Only use for values that are safe to serve slightly stale (bounded by the
 * TTL) and that are invalidated on the relevant writes below.
 */
export async function cached<T>(
  tenantKey: string,
  namespace: string,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = `${nsPrefix(tenantKey, namespace)}${key}`;
  const hit = await getCached<T>(fullKey);
  if (hit !== null) return hit;
  const value = await loader();
  await setCached(fullKey, value, ttlSeconds);
  return value;
}

async function clearPrefix(prefix: string): Promise<void> {
  const r = redis();
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
    cursor = next;
    if (keys.length > 0) await r.del(...keys);
  } while (cursor !== "0");
}

/**
 * Invalidate every cache derived from member data for ONE tenant: the
 * search/list results, the dashboard KPIs, and the Abteilung member counts.
 * Called from every member-mutating procedure (create/update/delete/restore/
 * bulk, Abteilung (de)assignment, import, snapshot restore). Scoped to the
 * tenant so one Verein's write never wipes another's cache.
 */
export async function invalidateMemberCaches(tenantKey: string): Promise<void> {
  try {
    await Promise.all([
      clearPrefix(nsPrefix(tenantKey, SEARCH_NS)),
      clearPrefix(nsPrefix(tenantKey, CACHE_NS.dashboard)),
      clearPrefix(nsPrefix(tenantKey, CACHE_NS.abteilungen)),
    ]);
  } catch {
    /* tolerate redis down */
  }
}

/**
 * Invalidate caches affected by a change to the Abteilung structure itself
 * (create/rename/update/delete) for one tenant: the Abteilung lists and the
 * dashboard's per-Abteilung breakdown.
 */
export async function invalidateAbteilungCaches(tenantKey: string): Promise<void> {
  try {
    await Promise.all([
      clearPrefix(nsPrefix(tenantKey, CACHE_NS.abteilungen)),
      clearPrefix(nsPrefix(tenantKey, CACHE_NS.dashboard)),
    ]);
  } catch {
    /* tolerate redis down */
  }
}

/** Invalidate the cached Beitragsarten (fee types) list for one tenant. */
export async function invalidateFeeTypeCaches(tenantKey: string): Promise<void> {
  try {
    await clearPrefix(nsPrefix(tenantKey, CACHE_NS.feeTypes));
  } catch {
    /* tolerate redis down */
  }
}
