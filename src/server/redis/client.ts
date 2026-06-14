import Redis from "ioredis";
import { env } from "~/server/env";
import { logger } from "~/server/lib/logger";

let client: Redis | undefined;

export function redis(): Redis {
  if (!client) {
    client = new Redis(env().REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    client.on("error", (err) => {
      if (env().NODE_ENV !== "test") logger.error("redis error", { error: err.message });
    });
  }
  return client;
}

/**
 * Close the Redis connection if one was opened. No-op when the lazy `redis()`
 * was never called. Prefers a graceful `QUIT`; falls back to a hard disconnect
 * if the server is unreachable so shutdown never hangs. Resets the memoized
 * client so a later `redis()` would reconnect.
 */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  const instance = client;
  client = undefined;
  try {
    await instance.quit();
  } catch {
    instance.disconnect();
  }
}

export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    const r = redis();
    const k = `rl:${opts.key}`;
    const count = await r.incr(k);
    let ttl = await r.ttl(k);
    // Re-arm the expiry whenever the key has none, not only on the first hit.
    // If the `expire` after the very first `incr` was lost (a transient Redis
    // error, a replica failover), the counter would otherwise live forever:
    // once it climbs past the limit the key stays permanently over-limit and
    // locks the caller out for good. ttl is -2 if the key vanished mid-call,
    // -1 if it exists without a TTL; both warrant re-arming.
    if (ttl < 0) {
      await r.expire(k, opts.windowSeconds);
      ttl = opts.windowSeconds;
    }
    return {
      allowed: count <= opts.limit,
      remaining: Math.max(0, opts.limit - count),
      resetAt: Math.floor(Date.now() / 1000) + Math.max(0, ttl),
    };
  } catch {
    // Fail open on Redis outage. Without rate-limiting, the HMAC layer is
    // still the gate; we'd rather accept signed traffic than 500.
    return { allowed: true, remaining: opts.limit, resetAt: 0 };
  }
}

export async function acquireNonce(nonce: string, ttlSeconds = 600): Promise<boolean> {
  try {
    const r = redis();
    const ok = await r.set(`nonce:${nonce}`, "1", "EX", ttlSeconds, "NX");
    return ok === "OK";
  } catch {
    // Fail open if Redis is down — same reasoning as rateLimit().
    return true;
  }
}
