import { createHash } from "node:crypto";
import { redis } from "~/server/redis/client";

// Cache key namespaces. Each is a prefix so a whole group can be invalidated
// with a SCAN+DEL. Keep them disjoint so invalidating one never clobbers
// another.
const SEARCH_PREFIX = "kontor2:members:search:";
export const CACHE_NS = {
  dashboard: "kontor2:cache:dashboard:",
  abteilungen: "kontor2:cache:abteilungen:",
  feeTypes: "kontor2:cache:feetypes:",
} as const;

const DEFAULT_TTL_SECONDS = 300;

export function searchCacheKey(query: unknown): string {
  const h = createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 24);
  return `${SEARCH_PREFIX}${h}`;
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
 * Read-through cache: return the cached value for `prefix+key`, or run
 * `loader`, cache its result, and return it. Always falls back to `loader`
 * when Redis is unavailable, so caching can never take the feature down.
 *
 * Only use for values that are safe to serve slightly stale (bounded by the
 * TTL) and that are invalidated on the relevant writes below.
 */
export async function cached<T>(
  prefix: string,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = `${prefix}${key}`;
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
 * Invalidate every cache derived from member data: the search/list results,
 * the dashboard KPIs, and the Abteilung member counts. Called from every
 * member-mutating procedure (create/update/delete/restore/bulk, Abteilung
 * (de)assignment, import, snapshot restore).
 */
export async function invalidateMemberCaches(): Promise<void> {
  try {
    await Promise.all([
      clearPrefix(SEARCH_PREFIX),
      clearPrefix(CACHE_NS.dashboard),
      clearPrefix(CACHE_NS.abteilungen),
    ]);
  } catch {
    /* tolerate redis down */
  }
}

/**
 * Invalidate caches affected by a change to the Abteilung structure itself
 * (create/rename/update/delete) — the Abteilung lists and the dashboard's
 * per-Abteilung breakdown.
 */
export async function invalidateAbteilungCaches(): Promise<void> {
  try {
    await Promise.all([clearPrefix(CACHE_NS.abteilungen), clearPrefix(CACHE_NS.dashboard)]);
  } catch {
    /* tolerate redis down */
  }
}

/** Invalidate the cached Beitragsarten (fee types) list. */
export async function invalidateFeeTypeCaches(): Promise<void> {
  try {
    await clearPrefix(CACHE_NS.feeTypes);
  } catch {
    /* tolerate redis down */
  }
}
