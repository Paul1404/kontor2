import { createHash } from "node:crypto";
import { redis } from "~/server/redis/client";

const PREFIX = "svuwv:members:search:";
const TTL_SECONDS = 300;

export function searchCacheKey(query: unknown): string {
  const h = createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 24);
  return `${PREFIX}${h}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis().get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCached(key: string, value: unknown): Promise<void> {
  try {
    await redis().set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } catch {
    /* cache miss is non-fatal */
  }
}

export async function invalidateMemberCaches(): Promise<void> {
  try {
    const r = redis();
    let cursor = "0";
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", `${PREFIX}*`, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) await r.del(...keys);
    } while (cursor !== "0");
  } catch {
    /* tolerate redis down */
  }
}
