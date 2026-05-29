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

export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    const r = redis();
    const k = `rl:${opts.key}`;
    const count = await r.incr(k);
    if (count === 1) {
      await r.expire(k, opts.windowSeconds);
    }
    const ttl = await r.ttl(k);
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
